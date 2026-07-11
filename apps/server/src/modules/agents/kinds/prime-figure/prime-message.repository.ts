import { randomUUID } from "node:crypto";
import type {
  PrimeMessage,
  PrimeMessageContent,
  PrimeMessageContentType,
  PrimeMessageSender,
} from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

interface PrimeMessageRow {
  id: string;
  owner_user_id: string;
  agent_id: string;
  conversation_id: string;
  sender: PrimeMessageSender;
  message_type: PrimeMessageContentType;
  content_json: string;
  occurred_at_ms: number;
  occurred_at_iso: string;
  timezone: string;
  created_at: number;
  updated_at: number;
}

export interface SavePrimeMessageInput {
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  sender: PrimeMessageSender;
  content: PrimeMessageContent;
  occurredAtMs?: number;
  timezone?: string;
}

export class PrimeMessageRepository {
  private readonly db = getDatabase();

  save(input: SavePrimeMessageInput): PrimeMessage {
    const now = Date.now();
    const occurredAtMs = input.occurredAtMs ?? now;
    const message: PrimeMessage = {
      id: `pmsg_${randomUUID()}`,
      ownerUserId: input.ownerUserId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      sender: input.sender,
      messageType: input.content.type,
      content: input.content,
      occurredAtMs,
      occurredAtIso: new Date(occurredAtMs).toISOString(),
      timezone: input.timezone ?? "UTC",
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `
          INSERT INTO prime_messages (
            id,
            owner_user_id,
            agent_id,
            conversation_id,
            sender,
            message_type,
            content_json,
            occurred_at_ms,
            occurred_at_iso,
            timezone,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        message.id,
        message.ownerUserId,
        message.agentId,
        message.conversationId,
        message.sender,
        message.messageType,
        JSON.stringify(message.content),
        message.occurredAtMs,
        message.occurredAtIso,
        message.timezone,
        message.createdAt,
        message.updatedAt,
      );

    return message;
  }

  listRecent(
    ownerUserId: string,
    agentId: string,
    limit = 100,
  ): PrimeMessage[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM prime_messages
          WHERE owner_user_id = ? AND agent_id = ?
          ORDER BY occurred_at_ms DESC, id DESC
          LIMIT ?
        `,
      )
      .all(
        ownerUserId,
        agentId,
        Math.min(Math.max(Math.trunc(limit), 1), 500),
      ) as unknown as PrimeMessageRow[];

    return rows.reverse().map(rowToMessage);
  }

  searchByKeywords(
    ownerUserId: string,
    agentId: string,
    keywords: string[],
    limit = 8,
  ): PrimeMessage[] {
    const normalized = keywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!normalized.length) return [];

    const conditions = normalized
      .map(() => "LOWER(content_json) LIKE ? ESCAPE '\\'")
      .join(" OR ");
    const patterns = normalized.map(
      (keyword) => `%${escapeLike(keyword.toLowerCase())}%`,
    );
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM prime_messages
          WHERE owner_user_id = ? AND agent_id = ?
            AND (${conditions})
          ORDER BY occurred_at_ms DESC, id DESC
          LIMIT ?
        `,
      )
      .all(
        ownerUserId,
        agentId,
        ...patterns,
        Math.min(Math.max(Math.trunc(limit), 1), 20),
      ) as unknown as PrimeMessageRow[];

    return rows.reverse().map(rowToMessage);
  }

  applyMediaAnnotation(input: {
    ownerUserId: string;
    messageId: string;
    expectedType: "image" | "video" | "voice";
    value: string;
  }) {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM prime_messages
          WHERE owner_user_id = ? AND id = ? AND message_type = ?
        `,
      )
      .get(
        input.ownerUserId,
        input.messageId,
        input.expectedType,
      ) as unknown as PrimeMessageRow | undefined;
    if (!row) return false;

    const content = parseJson<PrimeMessageContent | null>(
      row.content_json,
      null,
    );
    if (!content || content.type !== input.expectedType) return false;
    const nextContent: PrimeMessageContent =
      content.type === "voice"
        ? { ...content, transcript: input.value }
        : { ...content, description: input.value };
    const now = Date.now();
    const result = this.db
      .prepare(
        `
          UPDATE prime_messages
          SET content_json = ?, updated_at = ?
          WHERE owner_user_id = ? AND id = ? AND message_type = ?
        `,
      )
      .run(
        JSON.stringify(nextContent),
        now,
        input.ownerUserId,
        input.messageId,
        input.expectedType,
      );
    return result.changes === 1;
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function rowToMessage(row: PrimeMessageRow): PrimeMessage {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    sender: row.sender,
    messageType: row.message_type,
    content: parseJson<PrimeMessageContent>(row.content_json, {
      type: "text",
      text: "",
    }),
    occurredAtMs: row.occurred_at_ms,
    occurredAtIso: row.occurred_at_iso,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
