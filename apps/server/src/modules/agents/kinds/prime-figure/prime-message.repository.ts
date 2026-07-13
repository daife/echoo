import type {
  PrimeMessage,
  PrimeMessageContent,
  PrimeMessageSender,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { calculateStableContextEvictionStep } from "../../../../infra/config/context-window-config.js";
import { execute, queryRows } from "../../../../infra/database/mysql.js";
import { createId } from "../../../../shared/utils/id.js";
import {
  MessageCache,
  type CachedMessage,
} from "../../../../infra/redis/message-cache.js";

interface PrimeRow extends RowDataPacket {
  seq: number;
  id: string;
  owner_user_id: string;
  conversation_id: string;
  agent_id: string;
  role: "user" | "assistant";
  content: unknown;
  content_type: string;
  status: "pending" | "sent" | "delivered" | "failed" | "read";
  run_metadata: unknown;
  created_at: number;
  updated_at: number;
}
interface PrimeContextRow extends PrimeRow {
  context_start_message: number | string;
}
export interface SavePrimeMessageInput {
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  sender: PrimeMessageSender;
  content: PrimeMessageContent;
  occurredAtMs?: number;
}

export class PrimeMessageRepository {
  constructor(private readonly cache = new MessageCache()) {}
  /** Compatibility constructor for the unchanged decision executor; canonical persistence is messages. */
  async save(input: SavePrimeMessageInput): Promise<PrimeMessage> {
    const now = Date.now();
    const occurredAtMs = input.occurredAtMs ?? now;
    return {
      id: createId("msg"),
      ownerUserId: input.ownerUserId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      sender: input.sender,
      messageType: input.content.type,
      content: input.content,
      occurredAtMs,
      occurredAtIso: new Date(occurredAtMs).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
  }

  async listRecent(
    ownerUserId: string,
    agentId: string,
    limit = 100,
    conversationId?: string,
  ) {
    if (conversationId) {
      try {
        const cached = await this.cache.getRecent(
          ownerUserId,
          conversationId,
          limit,
        );
        if (cached)
          return cached.map((item) =>
            cachedToPrime(item, ownerUserId, agentId),
          );
      } catch (error) {
        console.warn(
          "Prime message cache read failed; falling back to MySQL.",
          error,
        );
      }
    }
    const rows = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.role IN ('user', 'assistant') AND messages.owner_user_id = ? AND conversations.agent_id = ?
       ORDER BY messages.seq DESC LIMIT ?`,
      [ownerUserId, agentId, Math.min(Math.max(Math.trunc(limit), 1), 500)],
    );
    rows.reverse();
    if (conversationId) {
      try {
        await this.cache.replaceRecent(
          ownerUserId,
          conversationId,
          rows.map((row) => ({
            sequence: row.seq,
            message: rowToCanonicalMessage(row),
          })),
          limit,
        );
      } catch (error) {
        console.warn("Prime message cache fill failed.", error);
      }
    }
    return rows.map(rowToMessage);
  }

  /** Stable LLM-only context window; every user/assistant message counts once. */
  async listContextWindow(
    ownerUserId: string,
    conversationId: string,
    minimumMessages = 150,
    maximumMessages = 249,
  ) {
    const normalizedMinimum = Math.max(1, Math.trunc(minimumMessages));
    const normalizedMaximum = Math.max(
      normalizedMinimum,
      Math.trunc(maximumMessages),
    );
    const evictionStep = calculateStableContextEvictionStep({
      minimum: normalizedMinimum,
      maximum: normalizedMaximum,
    });
    const rows = await queryRows<PrimeContextRow>(
      `WITH eligible_messages AS (
         SELECT messages.*, conversations.agent_id,
          ROW_NUMBER() OVER (ORDER BY messages.seq) AS context_message_number,
          COUNT(*) OVER () AS context_message_count
         FROM messages
         JOIN conversations ON conversations.id = messages.conversation_id
         WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
          AND messages.role IN ('user', 'assistant')
       ), context_messages AS (
         SELECT eligible_messages.*,
          FLOOR(GREATEST(0, context_message_count - ?) / ?) * ?
            AS context_start_message
         FROM eligible_messages
       )
       SELECT * FROM context_messages
       WHERE context_message_number > context_start_message
       ORDER BY seq ASC`,
      [
        ownerUserId,
        conversationId,
        normalizedMinimum,
        evictionStep,
        evictionStep,
      ],
    );
    return rows.map(rowToMessage);
  }

  async findLatestEndUserCreatedAt(
    ownerUserId: string,
    conversationId: string,
  ) {
    const row = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
       AND messages.role = 'user' ORDER BY messages.seq DESC LIMIT 1`,
      [ownerUserId, conversationId],
    );
    return row[0]?.created_at ?? null;
  }

  async findLatestAssistantSequence(
    ownerUserId: string,
    conversationId: string,
  ) {
    const row = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
       AND messages.role = 'assistant' ORDER BY messages.seq DESC LIMIT 1`,
      [ownerUserId, conversationId],
    );
    return row[0]?.seq ?? 0;
  }

  async listEndUserAfterSequence(
    ownerUserId: string,
    conversationId: string,
    sequence: number,
  ) {
    const rows = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
       AND messages.role = 'user' AND messages.seq > ?
       ORDER BY messages.seq ASC`,
      [ownerUserId, conversationId, sequence],
    );
    return rows.map(rowToMessage);
  }

  async searchByKeywords(
    ownerUserId: string,
    agentId: string,
    keywords: string[],
    limit = 8,
  ) {
    const terms = keywords
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!terms.length) return [];
    const conditions = terms
      .map(() => "messages.search_text LIKE ?")
      .join(" OR ");
    const rows = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.role IN ('user', 'assistant') AND messages.owner_user_id = ? AND conversations.agent_id = ?
       AND (${conditions}) ORDER BY messages.seq DESC LIMIT ?`,
      [
        ownerUserId,
        agentId,
        ...terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`),
        Math.min(Math.max(Math.trunc(limit), 1), 20),
      ],
    );
    return rows.reverse().map(rowToMessage);
  }

  async applyMediaAnnotation(input: {
    ownerUserId: string;
    messageId: string;
    conversationId: string;
    expectedType: "image" | "video" | "voice";
    value: string;
  }) {
    const path = input.expectedType === "voice" ? "transcript" : "description";
    const result = await execute(
      `UPDATE messages SET run_metadata = JSON_SET(COALESCE(run_metadata, JSON_OBJECT()),
       CONCAT('$.primeContent.', ?), ?), updated_at = ?
       WHERE owner_user_id = ? AND id = ? AND content_type = ?`,
      [
        path,
        input.value,
        Date.now(),
        input.ownerUserId,
        input.messageId,
        input.expectedType,
      ],
    );
    if (result.affectedRows === 1) {
      try {
        await this.cache.invalidate(input.ownerUserId, input.conversationId);
      } catch (error) {
        console.warn("Annotated media cache invalidation failed.", error);
      }
    }
    return result.affectedRows === 1;
  }
}

const SELECT_PRIME = `SELECT messages.*, conversations.agent_id FROM messages
  JOIN conversations ON conversations.id = messages.conversation_id`;

function rowToMessage(row: PrimeRow): PrimeMessage {
  const content = parseJson<Record<string, unknown>>(row.content, {});
  const run = parseJson<Record<string, unknown>>(row.run_metadata, {});
  const primeContent = (
    run.primeContent && typeof run.primeContent === "object"
      ? run.primeContent
      : toPrimeContent(row.content_type, content)
  ) as PrimeMessageContent;
  const sender = row.role === "user" ? "end_user" : "prime_figure";
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    agentId: row.agent_id,
    sequence: row.seq,
    conversationId: row.conversation_id,
    sender,
    messageType: primeContent.type,
    content: primeContent,
    occurredAtMs: row.created_at,
    occurredAtIso: new Date(row.created_at).toISOString(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCanonicalMessage(row: PrimeRow) {
  const run = parseJson<Record<string, unknown>>(row.run_metadata, {});
  const { providerId, model, ...metadata } = run;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    contentType: row.content_type as
      "text" | "image" | "voice" | "video" | "file" | "system",
    content: parseJson<Record<string, unknown>>(row.content, {}),
    status: row.status,
    ...(typeof providerId === "string" ? { providerId } : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cachedToPrime(
  cached: CachedMessage,
  ownerUserId: string,
  agentId: string,
): PrimeMessage {
  const message = cached.message;
  const metadata = message.metadata ?? {};
  const primeContent =
    metadata.primeContent && typeof metadata.primeContent === "object"
      ? (metadata.primeContent as PrimeMessageContent)
      : toPrimeContent(
          message.contentType,
          message.content as unknown as Record<string, unknown>,
        );
  return {
    id: message.id,
    sequence: cached.sequence,
    ownerUserId,
    agentId,
    conversationId: message.conversationId,
    sender: message.role === "user" ? "end_user" : "prime_figure",
    messageType: primeContent.type,
    content: primeContent,
    occurredAtMs: message.createdAt,
    occurredAtIso: new Date(message.createdAt).toISOString(),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function toPrimeContent(
  type: string,
  content: Record<string, unknown>,
): PrimeMessageContent {
  if (type === "image")
    return {
      type: "image",
      description: String(content.text ?? ""),
      referenceResourceUrls: [],
      ...(typeof content.resourceId === "string"
        ? { resourceId: content.resourceId }
        : {}),
    };
  if (type === "voice")
    return {
      type: "voice",
      transcript: String(content.text ?? ""),
      ...(typeof content.resourceId === "string"
        ? { resourceId: content.resourceId }
        : {}),
    };
  return { type: "text", text: String(content.text ?? "") };
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
