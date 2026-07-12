import type { Conversation } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, queryRows } from "../../infra/database/mysql.js";

interface ConversationRow extends RowDataPacket {
  id: string; title: string; type: Conversation["type"]; agent_id: string | null;
  last_message_preview: string | null; unread_count: number; pinned_at: number | null;
  created_at: number; updated_at: number;
}

export class ConversationRepository {
  async listByOwner(ownerUserId: string) {
    const rows = await queryRows<ConversationRow>(
      `SELECT * FROM conversations WHERE owner_user_id = ?
       ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC`, [ownerUserId]);
    return rows.map(rowToConversation);
  }
  async findByIdForOwner(ownerUserId: string, conversationId: string) {
    const row = await queryOne<ConversationRow>(
      "SELECT * FROM conversations WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, conversationId]);
    return row ? rowToConversation(row) : null;
  }
  async updatePreview(input: { ownerUserId: string; conversationId: string;
    preview: string | null; updatedAt: number; incrementUnread?: boolean; unreadIncrement?: number }) {
    await execute(
      `UPDATE conversations SET last_message_preview = ?, unread_count = unread_count + ?, updated_at = ?
       WHERE owner_user_id = ? AND id = ?`,
      [input.preview, input.unreadIncrement ?? (input.incrementUnread ? 1 : 0),
        input.updatedAt, input.ownerUserId, input.conversationId]);
  }
  async deleteForOwner(ownerUserId: string, conversationId: string) {
    const result = await execute(
      "DELETE FROM conversations WHERE owner_user_id = ? AND id = ?", [ownerUserId, conversationId]);
    return result.affectedRows > 0;
  }
}

function rowToConversation(row: ConversationRow): Conversation {
  return { id: row.id, title: row.title, type: row.type,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.last_message_preview ? { lastMessagePreview: row.last_message_preview } : {}),
    unreadCount: row.unread_count, ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
