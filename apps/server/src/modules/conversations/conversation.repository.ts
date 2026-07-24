import type { Conversation } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { ChangeEventRepository } from "../sync/change-event.repository.js";

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

export interface ConversationPreviewUpdate {
  ownerUserId: string;
  conversationId: string;
  preview: string | null;
  updatedAt: number;
  incrementUnread?: boolean;
  unreadIncrement?: number;
}

export class ConversationRepository {
  constructor(private readonly events = new ChangeEventRepository()) {}
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
  updatePreview(input: ConversationPreviewUpdate) {
    return updateConversationPreview(this.events, input);
  }

  async markRead(ownerUserId: string, conversationId: string) {
    return withTransaction(async (connection) => {
      const row = await queryOne<ConversationRow>(
        `SELECT * FROM conversations
         WHERE owner_user_id = ? AND id = ? FOR UPDATE`,
        [ownerUserId, conversationId],
        connection,
      );
      if (!row) return null;
      if (row.unread_count > 0) {
        await execute(
          `UPDATE conversations SET unread_count = 0
           WHERE owner_user_id = ? AND id = ?`,
          [ownerUserId, conversationId],
          connection,
        );
        await this.events.append(
          {
            ownerUserId,
            entityType: "conversation",
            entityId: conversationId,
            conversationId,
            operation: "upsert",
          },
          connection,
        );
      }
      return rowToConversation({ ...row, unread_count: 0 });
    });
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
        if (result.affectedRows)
          await this.events.append(
            {
              ownerUserId,
              entityType: "agent",
              entityId: conversation.agent_id,
              conversationId,
              operation: "delete",
            },
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
      `SELECT CAST(JSON_EXTRACT(runtime.state_json,
       '$.primeDispatch.lastHandledEndUserSeq') AS UNSIGNED) AS handled_seq
       FROM conversations JOIN agent_runtime_states runtime
         ON runtime.conversation_id = conversations.id
       WHERE conversations.owner_user_id = ? AND conversations.id = ?`,
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
      `UPDATE agent_runtime_states runtime JOIN conversations
         ON conversations.id = runtime.conversation_id
       SET runtime.state_json = JSON_SET(
       JSON_SET(runtime.state_json, '$.primeDispatch', COALESCE(
         JSON_EXTRACT(runtime.state_json, '$.primeDispatch'), JSON_OBJECT())),
       '$.primeDispatch.lastHandledEndUserSeq', CAST(GREATEST(COALESCE(CAST(
         JSON_EXTRACT(runtime.state_json, '$.primeDispatch.lastHandledEndUserSeq') AS UNSIGNED), 0), ?)
         AS UNSIGNED)), runtime.version = runtime.version + 1, runtime.updated_at = ?
       WHERE conversations.owner_user_id = ? AND conversations.id = ?`,
      [sequence, Date.now(), ownerUserId, conversationId],
    );
  }
}

export function truncatePreview(value: string | null) {
  return value === null ? null : Array.from(value).slice(0, 500).join("");
}

export async function updateConversationPreview(
  events: Pick<ChangeEventRepository, "append">,
  input: ConversationPreviewUpdate,
  transaction: typeof withTransaction = withTransaction,
  run: typeof execute = execute,
) {
  const unreadIncrement =
    input.unreadIncrement ?? (input.incrementUnread ? 1 : 0);
  await transaction(async (connection) => {
    await run(
      `UPDATE conversations SET last_message_preview = ?, unread_count = unread_count + ?, updated_at = ?
       WHERE owner_user_id = ? AND id = ?`,
      [
        truncatePreview(input.preview),
        unreadIncrement,
        input.updatedAt,
        input.ownerUserId,
        input.conversationId,
      ],
      connection,
    );
    await events.append(
      {
        ownerUserId: input.ownerUserId,
        entityType: "conversation",
        entityId: input.conversationId,
        conversationId: input.conversationId,
        operation: "upsert",
        createdAt: input.updatedAt,
      },
      connection,
    );
  });
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
