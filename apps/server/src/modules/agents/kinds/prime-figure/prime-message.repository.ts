import type { PrimeMessage, PrimeMessageContent, PrimeMessageSender } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryRows } from "../../../../infra/database/mysql.js";
import { createId } from "../../../../shared/utils/id.js";

interface PrimeRow extends RowDataPacket {
  id: string; owner_user_id: string; conversation_id: string; agent_id: string;
  role: "user" | "assistant"; content: unknown; content_type: string;
  run_metadata: unknown; created_at: number; updated_at: number;
}
export interface SavePrimeMessageInput {
  ownerUserId: string; agentId: string; conversationId: string;
  sender: PrimeMessageSender; content: PrimeMessageContent; occurredAtMs?: number;
}

export class PrimeMessageRepository {
  /** Compatibility constructor for the unchanged decision executor; canonical persistence is messages. */
  async save(input: SavePrimeMessageInput): Promise<PrimeMessage> {
    const now = Date.now();
    const occurredAtMs = input.occurredAtMs ?? now;
    return { id: createId("msg"), ownerUserId: input.ownerUserId, agentId: input.agentId,
      conversationId: input.conversationId, sender: input.sender,
      messageType: input.content.type, content: input.content, occurredAtMs,
      occurredAtIso: new Date(occurredAtMs).toISOString(),
      createdAt: now, updatedAt: now };
  }

  async listRecent(ownerUserId: string, agentId: string, limit = 100) {
    const rows = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.role IN ('user', 'assistant') AND messages.owner_user_id = ? AND conversations.agent_id = ?
       ORDER BY messages.seq DESC LIMIT ?`,
      [ownerUserId, agentId, Math.min(Math.max(Math.trunc(limit), 1), 500)]);
    return rows.reverse().map(rowToMessage);
  }

  async searchByKeywords(ownerUserId: string, agentId: string, keywords: string[], limit = 8) {
    const terms = keywords.map((value) => value.trim()).filter(Boolean).slice(0, 6);
    if (!terms.length) return [];
    const conditions = terms.map(() => "messages.search_text LIKE ?").join(" OR ");
    const rows = await queryRows<PrimeRow>(
      `${SELECT_PRIME} WHERE messages.role IN ('user', 'assistant') AND messages.owner_user_id = ? AND conversations.agent_id = ?
       AND (${conditions}) ORDER BY messages.seq DESC LIMIT ?`,
      [ownerUserId, agentId, ...terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`),
        Math.min(Math.max(Math.trunc(limit), 1), 20)]);
    return rows.reverse().map(rowToMessage);
  }

  async applyMediaAnnotation(input: { ownerUserId: string; messageId: string;
    expectedType: "image" | "video" | "voice"; value: string }) {
    const path = input.expectedType === "voice" ? "transcript" : "description";
    const result = await execute(
      `UPDATE messages SET run_metadata = JSON_SET(COALESCE(run_metadata, JSON_OBJECT()),
       CONCAT('$.primeContent.', ?), ?), updated_at = ?
       WHERE owner_user_id = ? AND id = ? AND content_type = ?`,
      [path, input.value, Date.now(), input.ownerUserId, input.messageId, input.expectedType]);
    return result.affectedRows === 1;
  }
}

const SELECT_PRIME = `SELECT messages.*, conversations.agent_id FROM messages
  JOIN conversations ON conversations.id = messages.conversation_id`;

function rowToMessage(row: PrimeRow): PrimeMessage {
  const content = parseJson<Record<string, unknown>>(row.content, {});
  const run = parseJson<Record<string, unknown>>(row.run_metadata, {});
  const primeContent = (run.primeContent && typeof run.primeContent === "object"
    ? run.primeContent : toPrimeContent(row.content_type, content)) as PrimeMessageContent;
  const sender = row.role === "user" ? "end_user" : "prime_figure";
  return { id: row.id, ownerUserId: row.owner_user_id, agentId: row.agent_id,
    conversationId: row.conversation_id, sender, messageType: primeContent.type,
    content: primeContent, occurredAtMs: row.created_at,
    occurredAtIso: new Date(row.created_at).toISOString(),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function toPrimeContent(type: string, content: Record<string, unknown>): PrimeMessageContent {
  if (type === "image") return { type: "image", description: String(content.text ?? ""),
    referenceResourceUrls: [], ...(typeof content.resourceId === "string" ? { resourceId: content.resourceId } : {}) };
  if (type === "voice") return { type: "voice", transcript: String(content.text ?? ""),
    ...(typeof content.resourceId === "string" ? { resourceId: content.resourceId } : {}) };
  return { type: "text", text: String(content.text ?? "") };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
