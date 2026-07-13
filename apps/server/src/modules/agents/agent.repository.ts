import type {
  Agent,
  AgentResourceUpload,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  PrimeFigureAgent,
  PrimeFigureState,
  PrimeFigureVariableValue,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";
import { ResourceRepository } from "../resources/resource.repository.js";

interface AgentRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  type: Agent["type"];
  name: string;
  definition: unknown;
  runtime_state: unknown;
  is_public: number | boolean;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
}

type CreateAgentInput = CreateSliceFigureRequest | CreatePrimeFigureRequest;
type UpdateAgentInput = UpdateSliceFigureRequest | UpdatePrimeFigureRequest;

export class AgentRepository {
  constructor(private readonly resources = new ResourceRepository()) {}

  async listByOwner(ownerUserId: string) {
    const rows = await queryRows<AgentRow>(`${SELECT_AGENT}
      WHERE agents.owner_user_id = ? ORDER BY agents.created_at DESC`, [ownerUserId]);
    return rows.map(rowToAgent);
  }

  async findByConversation(ownerUserId: string, conversationId: string) {
    const row = await queryOne<AgentRow>(`${SELECT_AGENT}
      WHERE agents.owner_user_id = ? AND conversations.id = ?`, [ownerUserId, conversationId]);
    return row ? rowToAgent(row) : null;
  }

  async findById(ownerUserId: string, agentId: string) {
    const row = await queryOne<AgentRow>(`${SELECT_AGENT}
      WHERE agents.owner_user_id = ? AND agents.id = ?`, [ownerUserId, agentId]);
    return row ? rowToAgent(row) : null;
  }

  async create(ownerUserId: string, input: CreateAgentInput) {
    const now = Date.now();
    const id = createId("agent");
    const conversationId = createId("conv");
    const avatar = input.avatar
      ? await this.resources.saveImage(ownerUserId, "agent_avatar", input.avatar)
      : null;
    const cover = input.cover
      ? await this.resources.saveImage(ownerUserId, "agent_cover", input.cover)
      : null;
    const definition = buildDefinition(input, avatar?.publicPath, cover?.publicPath);
    const runtimeState = buildRuntimeState(input, now);
    const preview = getInitialPreview(input);

    await withTransaction(async (connection) => {
      await execute(
        `INSERT INTO agents
         (id, owner_user_id, type, name, definition, runtime_state, is_public,
          next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [id, ownerUserId, input.type, input.name, JSON.stringify(definition),
          JSON.stringify(runtimeState), input.isPublic, now, now], connection);
      await execute(
        `INSERT INTO conversations
         (id, owner_user_id, agent_id, type, title, last_message_preview,
          unread_count, pinned_at, runtime_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, JSON_OBJECT(), ?, ?)`,
        [conversationId, ownerUserId, id, input.type, input.name, preview, now, now], connection);
      if (input.type === "slice-figure" && input.openingLine?.trim()) {
        await execute(
          `INSERT INTO messages
           (id, owner_user_id, conversation_id, client_message_id, role,
            content_type, content, status, run_metadata, read_at, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'assistant', 'text', ?, 'delivered', ?, NULL, ?, ?)`,
          [createId("msg"), ownerUserId, conversationId,
            JSON.stringify({ text: input.openingLine.trim() }),
            JSON.stringify({ kind: "opening_line" }), now, now], connection);
      }
    });
    return (await this.findById(ownerUserId, id))!;
  }

  async update(ownerUserId: string, agentId: string, input: UpdateAgentInput) {
    const existing = await this.findById(ownerUserId, agentId);
    if (!existing) return null;
    const resourceInput = input as {
      avatar?: AgentResourceUpload | null;
      cover?: AgentResourceUpload | null;
    };
    const nextAvatar =
      Object.prototype.hasOwnProperty.call(input, "avatar") && resourceInput.avatar !== undefined
        ? resourceInput.avatar
          ? await this.resources.saveImage(ownerUserId, "agent_avatar", resourceInput.avatar)
          : null
        : undefined;
    const nextCover =
      Object.prototype.hasOwnProperty.call(input, "cover") && resourceInput.cover !== undefined
        ? resourceInput.cover
          ? await this.resources.saveImage(ownerUserId, "agent_cover", resourceInput.cover)
          : null
        : undefined;
    const definition = {
      ...existing,
      ...baseDefinition(input),
      detail: buildDetail(existing.type, input),
    };
    if (nextAvatar !== undefined) {
      if (nextAvatar) definition.avatarResourcePath = nextAvatar.publicPath;
      else delete definition.avatarResourcePath;
    }
    if (nextCover !== undefined) {
      if (nextCover) definition.coverResourcePath = nextCover.publicPath;
      else delete definition.coverResourcePath;
    }
    delete (definition as Partial<Agent>).conversationId;
    delete (definition as Partial<PrimeFigureAgent>).muteUntilMs;
    const now = Date.now();
    try {
      await withTransaction(async (connection) => {
        await execute(
          "UPDATE agents SET name = ?, definition = ?, is_public = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
          [input.name, JSON.stringify(definition), input.isPublic, now, agentId, ownerUserId], connection);
        await execute(
          "UPDATE conversations SET title = ?, updated_at = ? WHERE agent_id = ? AND owner_user_id = ?",
          [input.name, now, agentId, ownerUserId], connection);
      });
    } catch (error) {
      await Promise.all([
        nextAvatar ? this.resources.deleteOwnedByPublicPath(ownerUserId, nextAvatar.publicPath) : Promise.resolve(false),
        nextCover ? this.resources.deleteOwnedByPublicPath(ownerUserId, nextCover.publicPath) : Promise.resolve(false),
      ]).catch(() => undefined);
      throw error;
    }
    await Promise.all([
      nextAvatar !== undefined && existing.avatarResourcePath &&
      existing.avatarResourcePath !== nextAvatar?.publicPath
        ? this.resources.deleteOwnedByPublicPath(ownerUserId, existing.avatarResourcePath)
        : Promise.resolve(false),
      nextCover !== undefined && existing.coverResourcePath &&
      existing.coverResourcePath !== nextCover?.publicPath
        ? this.resources.deleteOwnedByPublicPath(ownerUserId, existing.coverResourcePath)
        : Promise.resolve(false),
    ]).catch((error) => console.warn("旧角色资源清理失败。", error));
    return this.findById(ownerUserId, agentId);
  }

  async getRuntimeState<T>(ownerUserId: string, agentId: string) {
    const row = await queryOne<AgentRow>(
      "SELECT runtime_state FROM agents WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, agentId],
    );
    return row ? parseJson<T>(row.runtime_state, {} as T) : null;
  }

  async saveRuntimeState(ownerUserId: string, agentId: string, state: unknown, nextRunAt?: number | null) {
    await execute(
      "UPDATE agents SET runtime_state = ?, next_run_at = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
      [JSON.stringify(state), nextRunAt ?? null, Date.now(), ownerUserId, agentId],
    );
  }
}

const SELECT_AGENT = `SELECT agents.*, conversations.id AS conversation_id
  FROM agents LEFT JOIN conversations ON conversations.agent_id = agents.id`;

function rowToAgent(row: AgentRow): Agent {
  const stored = parseJson<Omit<Agent, "id" | "ownerUserId" | "conversationId" | "createdAt" | "updatedAt">>(row.definition, {} as never);
  const runtimeState =
    row.type === "prime-figure"
      ? parseJson<PrimeFigureState>(row.runtime_state, {} as PrimeFigureState)
      : null;
  return {
    ...stored,
    ...(row.type === "slice-figure"
      ? {
          detail: {
            ...(stored as Extract<Agent, { type: "slice-figure" }>).detail,
            replyAutoSegment: Boolean(
              (stored as Extract<Agent, { type: "slice-figure" }>).detail
                ?.replyAutoSegment,
            ),
          },
        }
      : {}),
    id: row.id,
    ownerUserId: row.owner_user_id,
    type: row.type,
    name: row.name,
    isPublic: Boolean(row.is_public),
    conversationId: row.conversation_id ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(runtimeState?.silenceUntilMs && runtimeState.silenceUntilMs > Date.now()
      ? { muteUntilMs: runtimeState.silenceUntilMs }
      : {}),
  } as Agent;
}

function buildDefinition(input: CreateAgentInput, avatar?: string, cover?: string) {
  return {
    type: input.type,
    ...baseDefinition(input),
    ...(avatar ? { avatarResourcePath: avatar } : {}),
    ...(cover ? { coverResourcePath: cover } : {}),
    detail: buildDetail(input.type, input),
  };
}

function baseDefinition(input: UpdateAgentInput | CreateAgentInput) {
  return {
    name: input.name,
    attributes: input.attributes ?? [],
    tags: input.tags ?? [],
    introduction: input.introduction ?? "",
    isPublic: input.isPublic,
  };
}

function buildDetail(type: Agent["type"], input: UpdateAgentInput | CreateAgentInput) {
  if (type === "slice-figure") {
    const value = input as CreateSliceFigureRequest;
    return {
      prologueHtml: value.prologueHtml ?? "",
      currentSituation: value.currentSituation ?? "",
      openingLine: value.openingLine ?? "",
      linkedAgentIds: value.linkedAgentIds ?? [],
      ...(value.unlockConditions ? { unlockConditions: value.unlockConditions } : {}),
      persona: value.persona,
      background: value.background,
      personality: value.personality,
      responseStyle: value.responseStyle,
      systemPrompt: value.systemPrompt,
      memorySummaryPrompt: value.memorySummaryPrompt,
      replyAutoSegment: value.replyAutoSegment ?? false,
    };
  }
  const value = input as CreatePrimeFigureRequest;
  return {
    prologueHtml: value.prologueHtml ?? "",
    linkedAgentIds: value.linkedAgentIds ?? [],
    ...(value.unlockConditions ? { unlockConditions: value.unlockConditions } : {}),
    persona: value.persona,
    background: value.background,
    personality: value.personality,
    responseStyle: value.responseStyle,
    decisionStyle: value.decisionStyle ?? "",
    currentSituation: value.currentSituation ?? "",
    schedule: { segments: value.schedule?.segments ?? [] },
    itinerary: value.itinerary ?? "",
    variableDefinitions: value.variableDefinitions ?? [],
  };
}

function buildRuntimeState(input: CreateAgentInput, now: number) {
  if (input.type !== "prime-figure") return {};
  const variables: Record<string, PrimeFigureVariableValue> = {};
  for (const definition of input.variableDefinitions ?? []) {
    if (definition.defaultValue !== undefined) variables[definition.key] = definition.defaultValue;
  }
  const state: PrimeFigureState = {
    variables,
    memories: [],
    mood: input.initialMood ?? "",
    moodObservedAtMs: now,
    relationshipStatus: input.initialRelationshipStatus ?? "",
    updatedAt: now,
  };
  return state;
}

function getInitialPreview(input: CreateAgentInput) {
  if (input.type === "slice-figure")
    return input.openingLine || input.introduction || input.persona;
  return input.introduction || input.currentSituation || input.persona;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
