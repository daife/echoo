import type { Conversation } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

interface ConversationRow {
  id: string;
  title: string;
  type: "direct" | "group" | "slice-figure" | "prime-figure" | "prime-world";
  agent_id: string | null;
  external_binding_id: string | null;
  last_message_preview: string | null;
  unread_count: number;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ConversationRepository {
  private readonly db = getDatabase();

  listByOwner(ownerUserId: string): Conversation[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM conversations
          WHERE owner_user_id = ?
          ORDER BY COALESCE(pinned_at, 0) DESC, updated_at DESC
        `
      )
      .all(ownerUserId) as unknown as ConversationRow[];

    return rows.map(rowToConversation);
  }

  findByIdForOwner(ownerUserId: string, conversationId: string): Conversation | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM conversations
          WHERE owner_user_id = ? AND id = ?
        `
      )
      .get(ownerUserId, conversationId) as ConversationRow | undefined;

    return row ? rowToConversation(row) : null;
  }

  updatePreview(input: {
    ownerUserId: string;
    conversationId: string;
    preview: string | null;
    updatedAt: number;
    incrementUnread?: boolean;
  }) {
    this.db
      .prepare(
        `
          UPDATE conversations
          SET
            last_message_preview = ?,
            unread_count = unread_count + ?,
            updated_at = ?
          WHERE owner_user_id = ? AND id = ?
        `
      )
      .run(input.preview, input.incrementUnread ? 1 : 0, input.updatedAt, input.ownerUserId, input.conversationId);
  }

  deleteForOwner(ownerUserId: string, conversationId: string) {
    const result = this.db
      .prepare(
        `
          DELETE FROM conversations
          WHERE owner_user_id = ? AND id = ?
        `
      )
      .run(ownerUserId, conversationId);

    return result.changes > 0;
  }
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.external_binding_id ? { externalBindingId: row.external_binding_id } : {}),
    ...(row.last_message_preview ? { lastMessagePreview: row.last_message_preview } : {}),
    unreadCount: row.unread_count,
    ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
