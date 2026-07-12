import type { Message, MessageContent, MessageContentType, MessageRole, MessageStatus } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, queryRows } from "../../infra/database/mysql.js";

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

export type SaveMessageInput = Message & { ownerUserId: string };

export class MessageRepository {
  async listAfter(ownerUserId: string, after?: string | null, conversationId?: string | null, limit = 500) {
    const rows = await queryRows<MessageRow>(
      `SELECT messages.* FROM messages
       LEFT JOIN messages cursor ON cursor.id = ? AND cursor.owner_user_id = ?
       WHERE messages.owner_user_id = ?
         AND (? IS NULL OR messages.conversation_id = ?)
         AND (cursor.seq IS NULL OR messages.seq > cursor.seq)
       ORDER BY messages.seq ASC LIMIT ?`,
      [after ?? null, ownerUserId, ownerUserId, conversationId ?? null,
        conversationId ?? null, clampLimit(limit, 500)],
    );
    return rows.map(rowToMessage);
  }

  async listByConversation(ownerUserId: string, conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number }) {
    const limit = clampLimit(options?.limit, 100);
    const cursor = options?.after ?? options?.before;
    const direction = options?.before ? "<" : ">";
    const order = options?.before || !options?.after ? "DESC" : "ASC";
    const rows = await queryRows<MessageRow>(
      `SELECT messages.* FROM messages
       LEFT JOIN messages cursor ON cursor.id = ? AND cursor.conversation_id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
         AND messages.status != 'failed'
         AND (? IS NULL OR cursor.seq IS NULL OR messages.seq ${direction} cursor.seq)
       ORDER BY messages.seq ${order} LIMIT ?`,
      [cursor ?? null, conversationId, ownerUserId, conversationId, cursor ?? null, limit],
    );
    if (order === "DESC") rows.reverse();
    return rows.map(rowToMessage);
  }

  async listRecentForContext(ownerUserId: string, conversationId: string, limit = 500) {
    const rows = await queryRows<MessageRow>(
      `SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ?
       ORDER BY seq DESC LIMIT ?`,
      [ownerUserId, conversationId, clampLimit(limit, 500)],
    );
    return rows.reverse().map(rowToMessage);
  }

  async findByClientMessageId(ownerUserId: string, clientMessageId?: string | null) {
    if (!clientMessageId) return null;
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND client_message_id = ?",
      [ownerUserId, clientMessageId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findByIdInConversation(ownerUserId: string, conversationId: string, messageId: string) {
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND conversation_id = ? AND id = ?",
      [ownerUserId, conversationId, messageId],
    );
    return row ? rowToMessage(row) : null;
  }

  async findNextAssistantMessage(ownerUserId: string, conversationId: string, after: Message) {
    const row = await queryOne<MessageRow>(
      `SELECT messages.* FROM messages JOIN messages cursor ON cursor.id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
         AND messages.role = 'assistant' AND messages.seq > cursor.seq
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

  async deleteAfterMessage(ownerUserId: string, conversationId: string, retainedThrough: Message) {
    const result = await execute(
      `DELETE messages FROM messages JOIN messages cursor ON cursor.id = ?
       WHERE messages.owner_user_id = ? AND messages.conversation_id = ? AND messages.seq > cursor.seq`,
      [retainedThrough.id, ownerUserId, conversationId],
    );
    return result.affectedRows;
  }

  async save(input: SaveMessageInput) {
    const runMetadata = {
      ...(input.metadata ?? {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
    };
    await execute(
      `INSERT INTO messages
       (id, owner_user_id, conversation_id, client_message_id, role, content_type,
        content, status, run_metadata, read_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), status = VALUES(status),
        run_metadata = VALUES(run_metadata), read_at = VALUES(read_at), updated_at = VALUES(updated_at)`,
      [input.id, input.ownerUserId, input.conversationId, input.clientMessageId ?? null,
        input.role, input.contentType, JSON.stringify(input.content), input.status,
        Object.keys(runMetadata).length ? JSON.stringify(runMetadata) : null,
        input.readAt ?? null, input.createdAt, input.updatedAt],
    );
    const { ownerUserId: _ownerUserId, ...message } = input;
    return message;
  }

  async markRead(ownerUserId: string, messageId: string, readAt: number) {
    const result = await execute(
      "UPDATE messages SET status = 'read', read_at = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
      [readAt, readAt, ownerUserId, messageId],
    );
    if (!result.affectedRows) return null;
    const row = await queryOne<MessageRow>(
      "SELECT * FROM messages WHERE owner_user_id = ? AND id = ?", [ownerUserId, messageId]);
    return row ? rowToMessage(row) : null;
  }
}

function rowToMessage(row: MessageRow): Message {
  const run = parseJson<Record<string, unknown>>(row.run_metadata, {});
  const { providerId, model, ...metadata } = run;
  return {
    id: row.id,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
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

function clampLimit(limit: number | undefined, fallback: number) {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 500);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
