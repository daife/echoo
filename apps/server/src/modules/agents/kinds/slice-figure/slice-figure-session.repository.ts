import { randomUUID } from "node:crypto";
import { getDatabase } from "../../../../infra/database/sqlite.js";

export class SliceFigureSessionRepository {
  private readonly db = getDatabase();

  createInitialConversation(input: {
    ownerUserId: string;
    agentId: string;
    name: string;
    preview: string;
    openingLine?: string;
    now: number;
  }) {
    const conversationId = `conv_${randomUUID()}`;

    this.db
      .prepare(
        `
          INSERT INTO conversations (
            id,
            owner_user_id,
            title,
            type,
            agent_id,
            last_message_preview,
            unread_count,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(conversationId, input.ownerUserId, input.name, "slice-figure", input.agentId, input.preview, 0, input.now, input.now);

    if (input.openingLine?.trim()) {
      this.db
        .prepare(
          `
            INSERT INTO messages (
              id,
              owner_user_id,
              conversation_id,
              role,
              content_type,
              content_json,
              status,
              metadata_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          `msg_${randomUUID()}`,
          input.ownerUserId,
          conversationId,
          "assistant",
          "text",
          JSON.stringify({ text: input.openingLine }),
          "delivered",
          JSON.stringify({ kind: "opening_line" }),
          input.now,
          input.now
        );
    }

    return conversationId;
  }

  updateConversationPreview(input: { ownerUserId: string; agentId: string; title: string; preview: string; updatedAt: number }) {
    this.db
      .prepare(
        `
          UPDATE conversations
          SET title = ?, last_message_preview = ?, updated_at = ?
          WHERE owner_user_id = ? AND agent_id = ?
        `
      )
      .run(input.title, input.preview, input.updatedAt, input.ownerUserId, input.agentId);
  }
}

