import { randomUUID } from "node:crypto";
import type { Agent, CreateSliceAgentRequest } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

interface AgentRow {
  id: string;
  owner_user_id: string;
  type: "core" | "slice";
  name: string;
  persona: string;
  background: string;
  personality: string;
  speech_style: string;
  opening_line: string;
  conversation_id: string;
  created_at: number;
  updated_at: number;
}

export class AgentRepository {
  private readonly db = getDatabase();

  listByOwner(ownerUserId: string): Agent[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            agents.*,
            conversations.id AS conversation_id
          FROM agents
          JOIN conversations ON conversations.agent_id = agents.id
          WHERE agents.owner_user_id = ?
          ORDER BY agents.created_at DESC
        `
      )
      .all(ownerUserId) as unknown as AgentRow[];

    return rows.map(rowToAgent);
  }

  createSlice(ownerUserId: string, input: CreateSliceAgentRequest): Agent {
    const now = Date.now();
    const agentId = `agent_${randomUUID()}`;
    const conversationId = `conv_${randomUUID()}`;

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
            INSERT INTO agents (
              id,
              owner_user_id,
              type,
              name,
              persona,
              background,
              personality,
              speech_style,
              opening_line,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          agentId,
          ownerUserId,
          "slice",
          input.name,
          input.persona,
          input.background,
          input.personality,
          input.speechStyle,
          input.openingLine,
          now,
          now
        );

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
        .run(conversationId, ownerUserId, input.name, "agent", agentId, input.openingLine, 0, now, now);

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      id: agentId,
      ownerUserId,
      type: "slice",
      name: input.name,
      persona: input.persona,
      background: input.background,
      personality: input.personality,
      speechStyle: input.speechStyle,
      openingLine: input.openingLine,
      conversationId,
      createdAt: now,
      updatedAt: now
    };
  }
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    type: row.type,
    name: row.name,
    persona: row.persona,
    background: row.background,
    personality: row.personality,
    speechStyle: row.speech_style,
    openingLine: row.opening_line,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
