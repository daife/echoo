import type {
  Message,
  MessageContent,
  MessageContentType,
  MessageRole,
  MessageStatus,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { calculateStableContextEvictionStep } from "../../infra/config/context-window-config.js";
import { execute, queryOne, queryRows } from "../../infra/database/mysql.js";
import { MessageCache } from "../../infra/redis/message-cache.js";

interface MessageRow extends RowDataPacket {
  seq: number;
  id: string;
  owner_user_id: string;
  conversation_id: string;
  client_message_id: string | null;
  role: MessageRole;
  content_type: MessageContentType;
  content: unknown;
  status: MessageStatus;
  run_metadata: unknown | null;
  read_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SliceFigureContextRow extends MessageRow {
  context_start_round: number | string;
}

export type SaveMessageInput = Message & { ownerUserId: string };

export class MessageRepository {
  constructor(private readonly cache = new MessageCache()) {}

  async listAfter(
    ownerUserId: string,
    after?: string | null,
    conversationId?: string | null,
    limit = 500,
  ) {
    const rows = await queryRows<MessageRow>(
      `SELECT messages.* FROM messages
       LEFT JOIN messages cursor_message ON cursor_message.id = ? AND cursor_message.owner_user_id = ?
       WHERE messages.owner_user_id = ?
         AND (? IS NULL OR messages.conversation_id = ?)
         AND (cursor_message.seq IS NULL OR messages.seq > cursor_message.seq)
       ORDER BY messages.seq ASC LIMIT ?`,
      [
        after ?? null,
        ownerUserId,
        ownerUserId,
        conversationId ?? null,
        conversationId ?? null,
        clampLimit(limit, 500),
      ],
    );
    return rows.map(rowToMessage);
  }

  async listByConversation(
    ownerUserId: string,
    conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number },
  ) {
    const limit = clampLimit(options?.limit, 100);
    if (!options?.after && !options?.before) {
      const cached = await this.readCached(ownerUserId, conversationId, limit);
      if (cached)
        return cached
          .map((item) => item.message)
          .filter((message) => message.status !== "failed");
    }
    const cursor = options?.after ?? options?.before;
    const direction = options?.before ? "<" : ">";
    const order = options?.before || !options?.after ? "DESC" : "ASC";
    const rows = await queryRows<MessageRow>(
      `SELECT messages.* FROM messages
       LEFT JOIN messages cursor_message ON cursor_message.id = ? AND cursor_message.conversation_id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
         AND messages.status != 'failed'
         AND (? IS NULL OR cursor_message.seq IS NULL OR messages.seq ${direction} cursor_message.seq)
       ORDER BY messages.seq ${order} LIMIT ?`,
      [
        cursor ?? null,
        conversationId,
        ownerUserId,
        conversationId,
        cursor ?? null,
        limit,
      ],
    );
    if (order === "DESC") rows.reverse();
    const messages = rows.map(rowToMessage);
    if (!options?.after && !options?.before)
      await this.replaceCache(ownerUserId, conversationId, rows, limit);
    return messages;
  }

  /** LLM-only context window; client history pagination must use listByConversation. */
  async listSliceFigureContextWindow(
    ownerUserId: string,
    conversationId: string,
    minimumRounds = 100,
    maximumRounds = 199,
  ) {
    const summary = await this.findLatestMemorySummary(
      ownerUserId,
      conversationId,
    );
    const summaryBoundary = getCoveredThroughSequence(summary) ?? 0;
    const normalizedMinimum = Math.max(1, Math.trunc(minimumRounds));
    const normalizedMaximum = Math.max(
      normalizedMinimum,
      Math.trunc(maximumRounds),
    );
    const evictionStep = calculateStableContextEvictionStep({
      minimum: normalizedMinimum,
      maximum: normalizedMaximum,
    });
    const rows = await queryRows<SliceFigureContextRow>(
      `WITH eligible_messages AS (
         SELECT messages.*,
          SUM(CASE WHEN messages.role = 'user' THEN 1 ELSE 0 END)
            OVER (ORDER BY messages.seq ROWS UNBOUNDED PRECEDING) AS user_round,
          SUM(CASE WHEN messages.role = 'user' THEN 1 ELSE 0 END)
            OVER () AS user_round_count
         FROM messages
          WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
           AND messages.seq > ?
          AND messages.content_type = 'text' AND messages.status != 'failed'
          AND messages.role IN ('user', 'assistant')
          AND messages.search_text REGEXP '[^[:space:]]'
       ), context_messages AS (
         SELECT eligible_messages.*,
          FLOOR(GREATEST(0, user_round_count - ?) / ?) * ? AS context_start_round
         FROM eligible_messages
       )
       SELECT * FROM context_messages
       WHERE context_start_round = 0 OR user_round > context_start_round
       ORDER BY seq ASC`,
      [
        ownerUserId,
        conversationId,
        summaryBoundary,
        normalizedMinimum,
        evictionStep,
        evictionStep,
      ],
    );
    return {
      messages: [...(summary ? [summary] : []), ...rows.map(rowToMessage)],
      isInitialWindow:
        !summary &&
        (rows.length === 0 || Number(rows[0].context_start_round) === 0),
    };
  }

  async findLatestMemorySummary(ownerUserId: string, conversationId: string) {
    const row = await queryOne<MessageRow>(
      `SELECT * FROM messages
       WHERE owner_user_id = ? AND conversation_id = ?
        AND role = 'system' AND content_type = 'system'
        AND status IN ('delivered', 'read')
        AND JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.kind')) = 'memory_summary'
       ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.coveredThroughSequence')) AS UNSIGNED) DESC
       LIMIT 1`,
      [ownerUserId, conversationId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findPendingMemorySummary(
    ownerUserId: string,
    conversationId: string,
    coveredThroughSequence: number,
  ) {
    const row = await queryOne<MessageRow>(
      `SELECT * FROM messages
       WHERE owner_user_id = ? AND conversation_id = ?
        AND role = 'system' AND content_type = 'system' AND status = 'pending'
        AND JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.kind')) = 'memory_summary'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.coveredThroughSequence')) AS UNSIGNED) = ?
       ORDER BY seq DESC LIMIT 1`,
      [ownerUserId, conversationId, coveredThroughSequence],
    );
    return row ? rowToMessage(row) : null;
  }

  async findSliceMemorySummaryBoundary(
    ownerUserId: string,
    conversationId: string,
    afterSequence: number,
    rounds: number,
  ) {
    const row = await queryOne<MessageRow>(
      `SELECT * FROM messages
       WHERE owner_user_id = ? AND conversation_id = ? AND seq > ?
        AND role = 'assistant' AND content_type = 'text'
        AND status IN ('delivered', 'read')
        AND search_text REGEXP '[^[:space:]]'
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.kind')), '') NOT IN ('opening_line', 'memory_summary')
       ORDER BY seq ASC LIMIT 1 OFFSET ?`,
      [ownerUserId, conversationId, afterSequence, Math.max(0, rounds - 1)],
    );
    return row ? rowToMessage(row) : null;
  }

  async listSliceMemorySummarySource(
    ownerUserId: string,
    conversationId: string,
    afterSequence: number,
    throughSequence: number,
  ) {
    const rows = await queryRows<MessageRow>(
      `SELECT * FROM messages
       WHERE owner_user_id = ? AND conversation_id = ?
        AND seq > ? AND seq <= ? AND content_type = 'text'
        AND role IN ('user', 'assistant')
        AND status != 'failed' AND search_text REGEXP '[^[:space:]]'
       ORDER BY seq ASC`,
      [ownerUserId, conversationId, afterSequence, throughSequence],
    );
    return rows.map(rowToMessage);
  }

  async completeMemorySummary(input: {
    ownerUserId: string;
    conversationId: string;
    messageId: string;
    text: string;
    providerId: string;
    model: string;
    updatedAt: number;
  }) {
    const result = await execute(
      `UPDATE messages SET content = JSON_SET(content, '$.text', ?), status = 'delivered',
        run_metadata = JSON_SET(COALESCE(run_metadata, JSON_OBJECT()), '$.providerId', ?, '$.model', ?), updated_at = ?
       WHERE owner_user_id = ? AND conversation_id = ? AND id = ? AND status = 'pending'`,
      [
        input.text,
        input.providerId,
        input.model,
        input.updatedAt,
        input.ownerUserId,
        input.conversationId,
        input.messageId,
      ],
    );
    if (!result.affectedRows) return null;
    await this.invalidateCache(input.ownerUserId, input.conversationId);
    return this.findByIdInConversation(
      input.ownerUserId,
      input.conversationId,
      input.messageId,
    );
  }

  async invalidateMemorySummariesCovering(
    ownerUserId: string,
    conversationId: string,
    sequence: number,
  ) {
    await execute(
      `UPDATE messages SET status = 'pending', content = JSON_SET(content, '$.text', ''),
        run_metadata = JSON_SET(run_metadata, '$.rebuild', true), updated_at = ?
       WHERE owner_user_id = ? AND conversation_id = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.kind')) = 'memory_summary'
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.coveredThroughSequence')) AS UNSIGNED) >= ?`,
      [Date.now(), ownerUserId, conversationId, sequence],
    );
    await this.invalidateCache(ownerUserId, conversationId);
    const rows = await queryRows<MessageRow>(
      `SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ?
       AND status = 'pending'
       AND JSON_UNQUOTE(JSON_EXTRACT(run_metadata, '$.kind')) = 'memory_summary'
       ORDER BY seq ASC`,
      [ownerUserId, conversationId],
    );
    return rows.map(rowToMessage);
  }

  async findByClientMessageId(
    ownerUserId: string,
    clientMessageId?: string | null,
  ) {
    if (!clientMessageId) return null;
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND client_message_id = ?",
      [ownerUserId, clientMessageId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findByIdInConversation(
    ownerUserId: string,
    conversationId: string,
    messageId: string,
  ) {
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ? AND id = ?",
      [ownerUserId, conversationId, messageId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findNextAssistantMessage(
    ownerUserId: string,
    conversationId: string,
    after: Message,
  ) {
    const row = await queryOne<MessageRow>(
      `SELECT messages.* FROM messages JOIN messages cursor_message ON cursor_message.id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
         AND messages.role = 'assistant' AND messages.seq > cursor_message.seq
       ORDER BY messages.seq ASC LIMIT 1`,
      [after.id, ownerUserId, conversationId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findLastByConversation(ownerUserId: string, conversationId: string) {
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ? ORDER BY seq DESC LIMIT 1",
      [ownerUserId, conversationId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findLastPreviewMessage(ownerUserId: string, conversationId: string) {
    const row = await queryOne<MessageRow>(
      `SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ?
       AND role IN ('user', 'assistant') AND status != 'failed'
       ORDER BY seq DESC LIMIT 1`,
      [ownerUserId, conversationId],
    );
    return row ? rowToMessage(row) : null;
  }

  async deleteAfterMessage(
    ownerUserId: string,
    conversationId: string,
    retainedThrough: Message,
  ) {
    const result = await execute(
      `DELETE messages FROM messages JOIN messages cursor_message ON cursor_message.id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ? AND messages.seq > cursor_message.seq`,
      [retainedThrough.id, ownerUserId, conversationId],
    );
    await this.invalidateCache(ownerUserId, conversationId);
    return result.affectedRows;
  }

  async save(input: SaveMessageInput) {
    const runMetadata = {
      ...(input.metadata ?? {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
    };
    const result = await execute(
      `INSERT INTO messages
       (id, owner_user_id, conversation_id, client_message_id, role, content_type,
        content, status, run_metadata, read_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq), content = VALUES(content), status = VALUES(status),
        run_metadata = VALUES(run_metadata), read_at = VALUES(read_at), updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.ownerUserId,
        input.conversationId,
        input.clientMessageId ?? null,
        input.role,
        input.contentType,
        JSON.stringify(input.content),
        input.status,
        Object.keys(runMetadata).length ? JSON.stringify(runMetadata) : null,
        input.readAt ?? null,
        input.createdAt,
        input.updatedAt,
      ],
    );
    const { ownerUserId: _ownerUserId, ...message } = input;
    const saved = { ...message, sequence: result.insertId };
    await this.upsertCache(input.ownerUserId, input.conversationId, {
      sequence: result.insertId,
      message: saved,
    });
    return saved;
  }

  async markRead(ownerUserId: string, messageId: string, readAt: number) {
    const result = await execute(
      "UPDATE messages SET status = 'read', read_at = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
      [readAt, readAt, ownerUserId, messageId],
    );
    if (!result.affectedRows) return null;
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, messageId],
    );
    if (!row) return null;
    const message = rowToMessage(row);
    await this.upsertCache(ownerUserId, row.conversation_id, {
      sequence: row.seq,
      message,
    });
    return message;
  }

  async updateText(
    ownerUserId: string,
    conversationId: string,
    messageId: string,
    text: string,
    updatedAt: number,
  ) {
    const result = await execute(
      `UPDATE messages SET content = JSON_SET(content, '$.text', ?), updated_at = ?
       WHERE owner_user_id = ? AND conversation_id = ? AND id = ?`,
      [text, updatedAt, ownerUserId, conversationId, messageId],
    );
    if (!result.affectedRows) return null;
    await this.invalidateCache(ownerUserId, conversationId);
    return this.findByIdInConversation(ownerUserId, conversationId, messageId);
  }

  async updateCachedLive(ownerUserId: string, message: Message) {
    try {
      await this.cache.updateLive(ownerUserId, message.conversationId, message);
    } catch (error) {
      console.warn("Live message cache update failed.", error);
    }
  }

  private async readCached(
    ownerUserId: string,
    conversationId: string,
    limit: number,
  ) {
    try {
      return await this.cache.getRecent(ownerUserId, conversationId, limit);
    } catch (error) {
      console.warn("Message cache read failed; falling back to MySQL.", error);
      return null;
    }
  }

  private async replaceCache(
    ownerUserId: string,
    conversationId: string,
    rows: MessageRow[],
    requestedLimit: number,
  ) {
    try {
      await this.cache.replaceRecent(
        ownerUserId,
        conversationId,
        rows.map((row) => ({ sequence: row.seq, message: rowToMessage(row) })),
        requestedLimit,
      );
    } catch (error) {
      console.warn("Message cache fill failed.", error);
    }
  }

  private async upsertCache(
    ownerUserId: string,
    conversationId: string,
    item: { sequence: number; message: Message },
  ) {
    try {
      await this.cache.upsert(ownerUserId, conversationId, item);
    } catch (error) {
      console.warn("Message cache write-through failed.", error);
    }
  }

  private async invalidateCache(ownerUserId: string, conversationId: string) {
    try {
      await this.cache.invalidate(ownerUserId, conversationId);
    } catch (error) {
      console.warn("Message cache invalidation failed.", error);
    }
  }
}

function rowToMessage(row: MessageRow): Message {
  const run = parseJson<Record<string, unknown>>(row.run_metadata, {});
  const { providerId, model, ...metadata } = run;
  return {
    id: row.id,
    sequence: row.seq,
    ...(row.client_message_id
      ? { clientMessageId: row.client_message_id }
      : {}),
    conversationId: row.conversation_id,
    role: row.role,
    contentType: row.content_type,
    content: parseJson<MessageContent>(row.content, {}),
    status: row.status,
    ...(typeof providerId === "string" ? { providerId } : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.read_at ? { readAt: row.read_at } : {}),
  };
}

function getCoveredThroughSequence(message: Message | null) {
  const value = message?.metadata?.coveredThroughSequence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampLimit(limit: number | undefined, fallback: number) {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 500);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
