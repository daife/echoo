import type { PrimeMessage, PrimeMessageContent } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { calculateStableContextEvictionStep } from "../../../../infra/config/context-window-config.js";
import { execute, queryRows } from "../../../../infra/database/mysql.js";
import { MessageCache } from "../../../../infra/redis/message-cache.js";

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
  context_message_count: number | string;
}
export class PrimeMessageRepository {
  constructor(private readonly cache = new MessageCache()) {}

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
          AND messages.role IN ('user', 'assistant') AND messages.status != 'failed'
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
    return {
      messages: rows.map(rowToMessage),
      totalEligibleMessages: Number(rows[0]?.context_message_count ?? 0),
    };
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
       AND messages.role = 'assistant' AND messages.status != 'failed'
       ORDER BY messages.seq DESC LIMIT 1`,
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
       AND messages.role = 'user' AND messages.status != 'failed' AND messages.seq > ?
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
      `${SELECT_PRIME} WHERE messages.role IN ('user', 'assistant') AND messages.status != 'failed'
       AND messages.owner_user_id = ? AND conversations.agent_id = ?
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
