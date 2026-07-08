import { randomUUID } from "node:crypto";
import type { Agent, AgentAttribute, CreateSliceAgentRequest } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";
import { ResourceRepository } from "../resources/resource.repository.js";

interface AgentRow {
  id: string;
  owner_user_id: string;
  type: "core" | "slice";
  avatar_resource_path: string | null;
  cover_resource_path: string | null;
  name: string;
  attributes_json: string;
  tags_json: string;
  introduction: string;
  prologue_html: string;
  opening_line: string;
  is_public: number;
  linked_agent_ids_json: string;
  unlock_conditions_json: string | null;
  persona: string;
  background: string;
  personality: string;
  response_style: string;
  conversation_id: string;
  created_at: number;
  updated_at: number;
}

export class AgentRepository {
  private readonly db = getDatabase();

  constructor(private readonly resources = new ResourceRepository()) {}

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
    let avatar: ReturnType<ResourceRepository["saveImage"]> | null = null;
    let cover: ReturnType<ResourceRepository["saveImage"]> | null = null;

    this.db.exec("BEGIN");
    try {
      avatar = input.avatar ? this.resources.saveImage(ownerUserId, "agent_avatar", input.avatar) : null;
      cover = input.cover ? this.resources.saveImage(ownerUserId, "agent_cover", input.cover) : null;

      this.db
        .prepare(
          `
            INSERT INTO agents (
              id,
              owner_user_id,
              type,
              avatar_resource_path,
              cover_resource_path,
              name,
              attributes_json,
              tags_json,
              introduction,
              prologue_html,
              opening_line,
              is_public,
              linked_agent_ids_json,
              unlock_conditions_json,
              persona,
              background,
              personality,
              response_style,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          agentId,
          ownerUserId,
          "slice",
          avatar?.publicPath ?? null,
          cover?.publicPath ?? null,
          input.name,
          JSON.stringify(input.attributes ?? []),
          JSON.stringify(input.tags ?? []),
          input.introduction ?? "",
          input.prologueHtml ?? "",
          input.openingLine ?? "",
          input.isPublic ? 1 : 0,
          JSON.stringify(input.linkedAgentIds ?? []),
          input.unlockConditions ? JSON.stringify(input.unlockConditions) : null,
          input.persona,
          input.background,
          input.personality,
          input.responseStyle,
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
        .run(conversationId, ownerUserId, input.name, "agent", agentId, input.openingLine || input.introduction || input.persona, 0, now, now);

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      id: agentId,
      ownerUserId,
      type: "slice",
      ...(avatar ? { avatarResourcePath: avatar.publicPath } : {}),
      ...(cover ? { coverResourcePath: cover.publicPath } : {}),
      name: input.name,
      attributes: input.attributes ?? [],
      tags: input.tags ?? [],
      introduction: input.introduction ?? "",
      prologueHtml: input.prologueHtml ?? "",
      openingLine: input.openingLine ?? "",
      isPublic: input.isPublic,
      linkedAgentIds: input.linkedAgentIds ?? [],
      ...(input.unlockConditions ? { unlockConditions: input.unlockConditions } : {}),
      persona: input.persona,
      background: input.background,
      personality: input.personality,
      responseStyle: input.responseStyle,
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
    ...(row.avatar_resource_path ? { avatarResourcePath: row.avatar_resource_path } : {}),
    ...(row.cover_resource_path ? { coverResourcePath: row.cover_resource_path } : {}),
    name: row.name,
    attributes: parseJson<AgentAttribute[]>(row.attributes_json, []),
    tags: parseJson<string[]>(row.tags_json, []),
    introduction: row.introduction,
    prologueHtml: row.prologue_html,
    openingLine: row.opening_line,
    isPublic: row.is_public === 1,
    linkedAgentIds: parseJson<string[]>(row.linked_agent_ids_json, []),
    ...(row.unlock_conditions_json ? { unlockConditions: parseJson<Record<string, unknown>>(row.unlock_conditions_json, {}) } : {}),
    persona: row.persona,
    background: row.background,
    personality: row.personality,
    responseStyle: row.response_style,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
