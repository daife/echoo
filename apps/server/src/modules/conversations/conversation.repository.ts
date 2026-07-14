import type { Conversation } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";

interface ConversationRow extends RowDataPacket {
  id: string;
  title: string;
  type: Conversation["type"];
  agent_id: string | null;
  last_message_preview: string | null;
  unread_count: number;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ConversationRepository {
  async listByOwner(ownerUserId: string) {
    const rows = await queryRows<ConversationRow>(
      `SELECT * FROM conversations WHERE owner_user_id = ?
       ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC`,
      [ownerUserId],
    );
    return rows.map(rowToConversation);
  }
  async findByIdForOwner(ownerUserId: string, conversationId: string) {
    const row = await queryOne<ConversationRow>(
      "SELECT * FROM conversations WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, conversationId],
    );
    return row ? rowToConversation(row) : null;
  }
  async updatePreview(input: {
    ownerUserId: string;
    conversationId: string;
    preview: string | null;
    updatedAt: number;
    incrementUnread?: boolean;
    unreadIncrement?: number;
  }) {
    await execute(
      `UPDATE conversations SET last_message_preview = ?, unread_count = unread_count + ?, updated_at = ?
       WHERE owner_user_id = ? AND id = ?`,
      [
        truncatePreview(input.preview),
        input.unreadIncrement ?? (input.incrementUnread ? 1 : 0),
        input.updatedAt,
        input.ownerUserId,
        input.conversationId,
      ],
    );
  }
  async deleteForOwner(ownerUserId: string, conversationId: string) {
    return withTransaction(async (connection) => {
      const conversation = await queryOne<ConversationRow>(
        `SELECT * FROM conversations
         WHERE owner_user_id = ? AND id = ? FOR UPDATE`,
        [ownerUserId, conversationId],
        connection,
      );
      if (!conversation) return false;

      if (conversation.agent_id) {
        const result = await execute(
          "DELETE FROM agents WHERE owner_user_id = ? AND id = ?",
          [ownerUserId, conversation.agent_id],
          connection,
        );
        return result.affectedRows > 0;
      }

      const result = await execute(
        "DELETE FROM conversations WHERE owner_user_id = ? AND id = ?",
        [ownerUserId, conversationId],
        connection,
      );
      return result.affectedRows > 0;
    });
  }

  async getPrimeHandledEndUserSequence(
    ownerUserId: string,
    conversationId: string,
  ) {
    const row = await queryOne<RowDataPacket & { handled_seq: number | null }>(
      `SELECT CAST(JSON_EXTRACT(runtime_state,
       '$.primeDispatch.lastHandledEndUserSeq') AS UNSIGNED) AS handled_seq
       FROM conversations WHERE owner_user_id = ? AND id = ?`,
      [ownerUserId, conversationId],
    );
    return row?.handled_seq ?? null;
  }

  async advancePrimeHandledEndUserSequence(
    ownerUserId: string,
    conversationId: string,
    sequence: number,
  ) {
    await execute(
      `UPDATE conversations SET runtime_state = JSON_SET(
       JSON_SET(runtime_state, '$.primeDispatch', COALESCE(
         JSON_EXTRACT(runtime_state, '$.primeDispatch'), JSON_OBJECT())),
       '$.primeDispatch.lastHandledEndUserSeq', CAST(GREATEST(COALESCE(CAST(
         JSON_EXTRACT(runtime_state, '$.primeDispatch.lastHandledEndUserSeq') AS UNSIGNED), 0), ?)
         AS UNSIGNED))
       WHERE owner_user_id = ? AND id = ?`,
      [sequence, ownerUserId, conversationId],
    );
  }
}

export function truncatePreview(value: string | null) {
  return value === null ? null : Array.from(value).slice(0, 500).join("");
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.last_message_preview
      ? { lastMessagePreview: row.last_message_preview }
      : {}),
    unreadCount: row.unread_count,
    ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
