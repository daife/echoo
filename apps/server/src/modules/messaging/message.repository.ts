import type { Message, MessageContent, MessageContentType, MessageRole, MessageStatus } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

interface MessageRow {
  id: string;
  owner_user_id: string;
  conversation_id: string;
  client_message_id: string | null;
  role: MessageRole;
  content_type: MessageContentType;
  content_json: string;
  status: MessageStatus;
  provider_id: string | null;
  model: string | null;
  metadata_json: string | null;
  read_at: number | null;
  created_at: number;
  updated_at: number;
}

export type SaveMessageInput = Message & {
  ownerUserId: string;
};

export class MessageRepository {
  private readonly db = getDatabase();

  listAfter(ownerUserId: string, after?: string | null, conversationId?: string | null, limit = 500): Message[] {
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
          LIMIT ?
        `
      )
      .all(after ?? null, ownerUserId, ownerUserId, conversationId ?? null, conversationId ?? null, after ?? null, clampLimit(limit, 500)) as unknown as MessageRow[];

    return rows.map(rowToMessage);
  }

  listByConversation(
    ownerUserId: string,
    conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number }
  ): Message[] {
    const limit = clampLimit(options?.limit, 100);

    if (options?.after) {
      return this.listConversationAfter(ownerUserId, conversationId, options.after, limit);
    }

    if (options?.before) {
      return this.listConversationBefore(ownerUserId, conversationId, options.before, limit);
    }

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND conversation_id = ?
            AND status != 'failed'
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(ownerUserId, conversationId, limit) as unknown as MessageRow[];

    return rows.reverse().map(rowToMessage);
  }

  listRecentForContext(ownerUserId: string, conversationId: string, limit = 500): Message[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND conversation_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(ownerUserId, conversationId, clampLimit(limit, 500)) as unknown as MessageRow[];

    return rows.reverse().map(rowToMessage);
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

  findByIdInConversation(ownerUserId: string, conversationId: string, messageId: string): Message | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND conversation_id = ? AND id = ?
        `
      )
      .get(ownerUserId, conversationId, messageId) as MessageRow | undefined;

    return row ? rowToMessage(row) : null;
  }

  findNextAssistantMessage(ownerUserId: string, conversationId: string, after: Message): Message | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ?
            AND conversation_id = ?
            AND role = 'assistant'
            AND (
              created_at > ?
              OR (created_at = ? AND id > ?)
            )
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `
      )
      .get(ownerUserId, conversationId, after.createdAt, after.createdAt, after.id) as MessageRow | undefined;

    return row ? rowToMessage(row) : null;
  }

  findLastByConversation(ownerUserId: string, conversationId: string): Message | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM messages
          WHERE owner_user_id = ? AND conversation_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get(ownerUserId, conversationId) as MessageRow | undefined;

    return row ? rowToMessage(row) : null;
  }

  deleteAfterMessage(ownerUserId: string, conversationId: string, retainedThrough: Message) {
    const result = this.db
      .prepare(
        `
          DELETE FROM messages
          WHERE owner_user_id = ?
            AND conversation_id = ?
            AND (
              created_at > ?
              OR (created_at = ? AND id > ?)
            )
        `
      )
      .run(ownerUserId, conversationId, retainedThrough.createdAt, retainedThrough.createdAt, retainedThrough.id);

    return result.changes;
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
            role,
            content_type,
            content_json,
            status,
            provider_id,
            model,
            metadata_json,
            read_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            content_json = excluded.content_json,
            provider_id = excluded.provider_id,
            model = excluded.model,
            metadata_json = excluded.metadata_json,
            read_at = excluded.read_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.id,
        input.ownerUserId,
        input.conversationId,
        input.clientMessageId ?? null,
        input.role,
        input.contentType,
        JSON.stringify(input.content),
        input.status,
        input.providerId ?? null,
        input.model ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
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

  private listConversationAfter(ownerUserId: string, conversationId: string, after: string, limit: number): Message[] {
    const rows = this.db
      .prepare(
        `
          SELECT messages.*
          FROM messages
          LEFT JOIN messages cursor
            ON cursor.id = ? AND cursor.owner_user_id = ? AND cursor.conversation_id = ?
          WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
            AND (
              cursor.id IS NULL
              OR messages.created_at > cursor.created_at
              OR (messages.created_at = cursor.created_at AND messages.id > cursor.id)
            )
          ORDER BY messages.created_at ASC, messages.id ASC
          LIMIT ?
        `
      )
      .all(after, ownerUserId, conversationId, ownerUserId, conversationId, limit) as unknown as MessageRow[];

    return rows.map(rowToMessage);
  }

  private listConversationBefore(ownerUserId: string, conversationId: string, before: string, limit: number): Message[] {
    const rows = this.db
      .prepare(
        `
          SELECT messages.*
          FROM messages
          LEFT JOIN messages cursor
            ON cursor.id = ? AND cursor.owner_user_id = ? AND cursor.conversation_id = ?
          WHERE messages.owner_user_id = ? AND messages.conversation_id = ?
            AND (
              cursor.id IS NULL
              OR messages.created_at < cursor.created_at
              OR (messages.created_at = cursor.created_at AND messages.id < cursor.id)
            )
          ORDER BY messages.created_at DESC, messages.id DESC
          LIMIT ?
        `
      )
      .all(before, ownerUserId, conversationId, ownerUserId, conversationId, limit) as unknown as MessageRow[];

    return rows.reverse().map(rowToMessage);
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
    conversationId: row.conversation_id,
    role: row.role,
    contentType: row.content_type,
    content: parseJson<MessageContent>(row.content_json, {}),
    status: row.status,
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.metadata_json ? { metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.read_at ? { readAt: row.read_at } : {})
  };
}

function clampLimit(limit: number | undefined, fallback: number) {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 500);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
