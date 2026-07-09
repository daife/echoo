import type { Agent, AgentAttribute, AgentResourceUpload, AgentType, PrimeFigureDetail, SliceFigureDetail } from "@echoo/shared";
import { randomUUID } from "node:crypto";
import { getDatabase } from "../../infra/database/sqlite.js";
import { ResourceRepository } from "../resources/resource.repository.js";

interface AgentRow {
  id: string;
  owner_user_id: string;
  type: AgentType;
  avatar_resource_path: string | null;
  cover_resource_path: string | null;
  name: string;
  attributes_json: string;
  tags_json: string;
  introduction: string;
  is_public: number;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
  prologue_html: string | null;
  current_situation: string | null;
  opening_line: string | null;
  linked_agent_ids_json: string | null;
  unlock_conditions_json: string | null;
  persona: string | null;
  background: string | null;
  personality: string | null;
  response_style: string | null;
  prime_persona: string | null;
  prime_background: string | null;
  prime_personality: string | null;
  prime_response_style: string | null;
  prime_decision_style: string | null;
  prime_current_situation: string | null;
  prime_schedule_json: string | null;
  prime_itinerary_json: string | null;
  prime_variable_definitions_json: string | null;
}

export interface AgentBaseInput {
  type: AgentType;
  avatar?: AgentResourceUpload | null;
  cover?: AgentResourceUpload | null;
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  isPublic: boolean;
}

export interface AgentBaseUpdateInput {
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  isPublic: boolean;
}

export interface CreatedAgentBase {
  id: string;
  ownerUserId: string;
  type: AgentType;
  avatarResourcePath?: string;
  coverResourcePath?: string;
  name: string;
  attributes: AgentAttribute[];
  tags: string[];
  introduction: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export class AgentRepository {
  private readonly db = getDatabase();

  constructor(private readonly resources = new ResourceRepository()) {}

  transaction<T>(callback: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listByOwner(ownerUserId: string): Agent[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            agents.*,
            conversations.id AS conversation_id,
            slice.prologue_html,
            slice.current_situation,
            slice.opening_line,
            slice.linked_agent_ids_json,
            slice.unlock_conditions_json,
            slice.persona,
            slice.background,
            slice.personality,
            slice.response_style,
            prime.persona AS prime_persona,
            prime.background AS prime_background,
            prime.personality AS prime_personality,
            prime.response_style AS prime_response_style,
            prime.decision_style AS prime_decision_style,
            prime.current_situation AS prime_current_situation,
            prime.schedule_json AS prime_schedule_json,
            prime.itinerary_json AS prime_itinerary_json,
            prime.variable_definitions_json AS prime_variable_definitions_json
          FROM agents
          LEFT JOIN conversations ON conversations.agent_id = agents.id
          LEFT JOIN agent_slice_figures slice ON slice.agent_id = agents.id
          LEFT JOIN agent_prime_figures prime ON prime.agent_id = agents.id
          WHERE agents.owner_user_id = ?
          ORDER BY agents.created_at DESC
        `
      )
      .all(ownerUserId) as unknown as AgentRow[];

    return rows.map(rowToAgent);
  }

  findByConversation(ownerUserId: string, conversationId: string): Agent | null {
    const row = this.db
      .prepare(
        `
          SELECT
            agents.*,
            conversations.id AS conversation_id,
            slice.prologue_html,
            slice.current_situation,
            slice.opening_line,
            slice.linked_agent_ids_json,
            slice.unlock_conditions_json,
            slice.persona,
            slice.background,
            slice.personality,
            slice.response_style,
            prime.persona AS prime_persona,
            prime.background AS prime_background,
            prime.personality AS prime_personality,
            prime.response_style AS prime_response_style,
            prime.decision_style AS prime_decision_style,
            prime.current_situation AS prime_current_situation,
            prime.schedule_json AS prime_schedule_json,
            prime.itinerary_json AS prime_itinerary_json,
            prime.variable_definitions_json AS prime_variable_definitions_json
          FROM agents
          JOIN conversations ON conversations.agent_id = agents.id
          LEFT JOIN agent_slice_figures slice ON slice.agent_id = agents.id
          LEFT JOIN agent_prime_figures prime ON prime.agent_id = agents.id
          WHERE agents.owner_user_id = ? AND conversations.id = ?
        `
      )
      .get(ownerUserId, conversationId) as AgentRow | undefined;

    return row ? rowToAgent(row) : null;
  }

  findById(ownerUserId: string, agentId: string): Agent | null {
    const row = this.db
      .prepare(
        `
          SELECT
            agents.*,
            conversations.id AS conversation_id,
            slice.prologue_html,
            slice.current_situation,
            slice.opening_line,
            slice.linked_agent_ids_json,
            slice.unlock_conditions_json,
            slice.persona,
            slice.background,
            slice.personality,
            slice.response_style,
            prime.persona AS prime_persona,
            prime.background AS prime_background,
            prime.personality AS prime_personality,
            prime.response_style AS prime_response_style,
            prime.decision_style AS prime_decision_style,
            prime.current_situation AS prime_current_situation,
            prime.schedule_json AS prime_schedule_json,
            prime.itinerary_json AS prime_itinerary_json,
            prime.variable_definitions_json AS prime_variable_definitions_json
          FROM agents
          LEFT JOIN conversations ON conversations.agent_id = agents.id
          LEFT JOIN agent_slice_figures slice ON slice.agent_id = agents.id
          LEFT JOIN agent_prime_figures prime ON prime.agent_id = agents.id
          WHERE agents.owner_user_id = ? AND agents.id = ?
        `
      )
      .get(ownerUserId, agentId) as AgentRow | undefined;

    return row ? rowToAgent(row) : null;
  }

  createBase(ownerUserId: string, input: AgentBaseInput): CreatedAgentBase {
    const now = Date.now();
    const agentId = `agent_${randomUUID()}`;
    const avatar = input.avatar ? this.resources.saveImage(ownerUserId, "agent_avatar", input.avatar) : null;
    const cover = input.cover ? this.resources.saveImage(ownerUserId, "agent_cover", input.cover) : null;
    const attributes = input.attributes ?? [];
    const tags = input.tags ?? [];
    const introduction = input.introduction ?? "";

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
            is_public,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        agentId,
        ownerUserId,
        input.type,
        avatar?.publicPath ?? null,
        cover?.publicPath ?? null,
        input.name,
        JSON.stringify(attributes),
        JSON.stringify(tags),
        introduction,
        input.isPublic ? 1 : 0,
        now,
        now
      );

    return {
      id: agentId,
      ownerUserId,
      type: input.type,
      ...(avatar ? { avatarResourcePath: avatar.publicPath } : {}),
      ...(cover ? { coverResourcePath: cover.publicPath } : {}),
      name: input.name,
      attributes,
      tags,
      introduction,
      isPublic: input.isPublic,
      createdAt: now,
      updatedAt: now
    };
  }

  updateBase(ownerUserId: string, agentId: string, input: AgentBaseUpdateInput, updatedAt = Date.now()) {
    this.db
      .prepare(
        `
          UPDATE agents
          SET
            name = ?,
            attributes_json = ?,
            tags_json = ?,
            introduction = ?,
            is_public = ?,
            updated_at = ?
          WHERE owner_user_id = ? AND id = ?
        `
      )
      .run(
        input.name,
        JSON.stringify(input.attributes ?? []),
        JSON.stringify(input.tags ?? []),
        input.introduction ?? "",
        input.isPublic ? 1 : 0,
        updatedAt,
        ownerUserId,
        agentId
      );
  }
}

function rowToAgent(row: AgentRow): Agent {
  const base = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ...(row.avatar_resource_path ? { avatarResourcePath: row.avatar_resource_path } : {}),
    ...(row.cover_resource_path ? { coverResourcePath: row.cover_resource_path } : {}),
    name: row.name,
    attributes: parseJson<AgentAttribute[]>(row.attributes_json, []),
    tags: parseJson<string[]>(row.tags_json, []),
    introduction: row.introduction,
    isPublic: row.is_public === 1,
    conversationId: row.conversation_id ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (row.type === "slice-figure") {
    return {
      ...base,
      type: "slice-figure",
      detail: rowToSliceDetail(row)
    };
  }

  if (row.type === "prime-world") {
    return {
      ...base,
      type: "prime-world",
      detail: { status: "placeholder" }
    };
  }

  return {
    ...base,
    type: "prime-figure",
    detail: rowToPrimeDetail(row)
  };
}

function rowToSliceDetail(row: AgentRow): SliceFigureDetail {
  return {
    prologueHtml: row.prologue_html ?? "",
    currentSituation: row.current_situation ?? "",
    openingLine: row.opening_line ?? "",
    linkedAgentIds: parseJson<string[]>(row.linked_agent_ids_json ?? "[]", []),
    ...(row.unlock_conditions_json ? { unlockConditions: parseJson<Record<string, unknown>>(row.unlock_conditions_json, {}) } : {}),
    persona: row.persona ?? "",
    background: row.background ?? "",
    personality: row.personality ?? "",
    responseStyle: row.response_style ?? ""
  };
}

function rowToPrimeDetail(row: AgentRow): PrimeFigureDetail {
  return {
    persona: row.prime_persona ?? "",
    background: row.prime_background ?? "",
    personality: row.prime_personality ?? "",
    responseStyle: row.prime_response_style ?? "",
    decisionStyle: row.prime_decision_style ?? "",
    currentSituation: row.prime_current_situation ?? "",
    schedule: parseJson<Record<string, unknown>>(row.prime_schedule_json ?? "{}", {}),
    itinerary: parseJson<Record<string, unknown>>(row.prime_itinerary_json ?? "{}", {}),
    variableDefinitions: parseJson(row.prime_variable_definitions_json ?? "[]", [])
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
