import type { Message, MessageContent, MessageContentType, MessageDirection, MessageRole, MessageStatus } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

interface MessageRow {
  id: string;
  owner_user_id: string;
  conversation_id: string;
  client_message_id: string | null;
  sender_id: string;
  role: MessageRole;
  direction: MessageDirection;
  content_type: MessageContentType;
  content_json: string;
  status: MessageStatus;
  provider_id: string | null;
  model: string | null;
  metadata_json: string | null;
  error_json: string | null;
  read_at: number | null;
  created_at: number;
  updated_at: number;
}

export type SaveMessageInput = Message & {
  ownerUserId: string;
};

export class MessageRepository {
  private readonly db = getDatabase();

  listAfter(ownerUserId: string, after?: string | null, conversationId?: string | null): Message[] {
    const rows = this.db
      .prepare(
        `
          SELECT messages.*
          FROM messages
          LEFT JOIN messages cursor
            ON cursor.id = ? AND cursor.owner_user_id = ?
          WHERE messages.owner_user_id = ?
            AND (? IS NULL OR messages.conversation_id = ?)
            AND (
              ? IS NULL
              OR cursor.id IS NULL
              OR messages.created_at > cursor.created_at
              OR (messages.created_at = cursor.created_at AND messages.id > cursor.id)
            )
          ORDER BY messages.created_at ASC, messages.id ASC
        `
      )
      .all(after ?? null, ownerUserId, ownerUserId, conversationId ?? null, conversationId ?? null, after ?? null) as unknown as MessageRow[];

    return rows.map(rowToMessage);
  }

  listByConversation(ownerUserId: string, conversationId: string): Message[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND conversation_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(ownerUserId, conversationId) as unknown as MessageRow[];

    return rows.map(rowToMessage);
  }

  findByClientMessageId(ownerUserId: string, clientMessageId?: string | null): Message | null {
    if (!clientMessageId) return null;

    const row = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND client_message_id = ?
        `
      )
      .get(ownerUserId, clientMessageId) as MessageRow | undefined;

    return row ? rowToMessage(row) : null;
  }

  save(input: SaveMessageInput) {
    this.db
      .prepare(
        `
          INSERT INTO messages (
            id,
            owner_user_id,
            conversation_id,
            client_message_id,
            sender_id,
            role,
            direction,
            content_type,
            content_json,
            status,
            provider_id,
            model,
            metadata_json,
            error_json,
            read_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            content_json = excluded.content_json,
            provider_id = excluded.provider_id,
            model = excluded.model,
            metadata_json = excluded.metadata_json,
            error_json = excluded.error_json,
            read_at = excluded.read_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.id,
        input.ownerUserId,
        input.conversationId,
        input.clientMessageId ?? null,
        input.senderId,
        input.role,
        input.direction,
        input.contentType,
        JSON.stringify(input.content),
        input.status,
        input.providerId ?? null,
        input.model ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.error ? JSON.stringify(input.error) : null,
        input.readAt ?? null,
        input.createdAt,
        input.updatedAt
      );

    const { ownerUserId: _ownerUserId, ...message } = input;
    return message;
  }

  markRead(ownerUserId: string, messageId: string, readAt: number) {
    const result = this.db
      .prepare(
        `
          UPDATE messages
          SET status = 'read', read_at = ?, updated_at = ?
          WHERE owner_user_id = ? AND id = ?
        `
      )
      .run(readAt, readAt, ownerUserId, messageId);

    if (result.changes === 0) return null;

    const row = this.db
      .prepare("SELECT * FROM messages WHERE owner_user_id = ? AND id = ?")
      .get(ownerUserId, messageId) as MessageRow | undefined;

    return row ? rowToMessage(row) : null;
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    role: row.role,
    direction: row.direction,
    contentType: row.content_type,
    content: parseJson<MessageContent>(row.content_json, {}),
    status: row.status,
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.metadata_json ? { metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}) } : {}),
    ...(row.error_json ? { error: parseJson<Record<string, unknown>>(row.error_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.read_at ? { readAt: row.read_at } : {})
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
