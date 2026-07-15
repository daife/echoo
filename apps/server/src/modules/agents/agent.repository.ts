import type {
  Agent,
  AgentResourceUpload,
  AgentExportResponse,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  PrimeFigureAgent,
  PrimeFigureEditSnapshot,
  PrimeFigureReferenceImage,
  PrimeFigureReferenceImageInput,
  PrimeFigureSticker,
  PrimeFigureStickerInput,
  PrimeFigureVariableDefinition,
  PrimeFigureState,
  PrimeFigureVariableValue,
  UpdatePrimeFigureRequest,
  UpdatePrimeFigurePreferencesRequest,
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
    const rows = await queryRows<AgentRow>(
      `${SELECT_AGENT}
      WHERE agents.owner_user_id = ? ORDER BY agents.created_at DESC`,
      [ownerUserId],
    );
    return rows.map(rowToAgent);
  }

  async findByConversation(ownerUserId: string, conversationId: string) {
    const row = await queryOne<AgentRow>(
      `${SELECT_AGENT}
      WHERE agents.owner_user_id = ? AND conversations.id = ?`,
      [ownerUserId, conversationId],
    );
    return row ? rowToAgent(row) : null;
  }

  async findById(ownerUserId: string, agentId: string) {
    const row = await queryOne<AgentRow>(
      `${SELECT_AGENT}
      WHERE agents.owner_user_id = ? AND agents.id = ?`,
      [ownerUserId, agentId],
    );
    return row ? rowToAgent(row) : null;
  }

  async create(ownerUserId: string, input: CreateAgentInput) {
    const now = Date.now();
    const id = createId("agent");
    const conversationId = createId("conv");
    let avatar: Awaited<ReturnType<ResourceRepository["saveImage"]>> | null =
      null;
    let cover: Awaited<ReturnType<ResourceRepository["saveImage"]>> | null =
      null;
    let referenceImages: PrimeFigureReferenceImage[] = [];
    let stickers: PrimeFigureSticker[] = [];
    try {
      avatar = input.avatar
        ? await this.resources.saveImage(
            ownerUserId,
            "agent_avatar",
            input.avatar,
          )
        : null;
      cover = input.cover
        ? await this.resources.saveImage(
            ownerUserId,
            "agent_cover",
            input.cover,
          )
        : null;
      referenceImages =
        input.type === "prime-figure"
          ? await this.resolveReferenceImages(
              ownerUserId,
              input.referenceImages ?? [],
              new Set(),
            )
          : [];
      stickers =
        input.type === "prime-figure"
          ? await this.resolveStickers(
              ownerUserId,
              input.stickers ?? [],
              new Set(),
            )
          : [];
      const definition = buildDefinition(
        input,
        avatar?.publicPath,
        cover?.publicPath,
        referenceImages,
        stickers,
      );
      const runtimeState = buildRuntimeState(input, now);
      const preview = getInitialPreview(input);

      await withTransaction(async (connection) => {
        await execute(
          `INSERT INTO agents
         (id, owner_user_id, type, name, definition, runtime_state, is_public,
          next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [
            id,
            ownerUserId,
            input.type,
            input.name,
            JSON.stringify(definition),
            JSON.stringify(runtimeState),
            input.isPublic,
            now,
            now,
          ],
          connection,
        );
        await execute(
          `INSERT INTO conversations
         (id, owner_user_id, agent_id, type, title, last_message_preview,
          unread_count, pinned_at, runtime_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, JSON_OBJECT(), ?, ?)`,
          [
            conversationId,
            ownerUserId,
            id,
            input.type,
            input.name,
            preview,
            now,
            now,
          ],
          connection,
        );
        if (input.type === "slice-figure" && input.openingLine?.trim()) {
          await execute(
            `INSERT INTO messages
           (id, owner_user_id, conversation_id, client_message_id, role,
            content_type, content, status, run_metadata, read_at, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'assistant', 'text', ?, 'delivered', ?, NULL, ?, ?)`,
            [
              createId("msg"),
              ownerUserId,
              conversationId,
              JSON.stringify({ text: input.openingLine.trim() }),
              JSON.stringify({ kind: "opening_line" }),
              now,
              now,
            ],
            connection,
          );
        }
      });
      return (await this.findById(ownerUserId, id))!;
    } catch (error) {
      await this.deletePreparedResources(ownerUserId, [
        avatar?.publicPath,
        cover?.publicPath,
        ...referenceImages.map((item) => item.resourcePath),
        ...stickers.map((item) => item.resourcePath),
      ]);
      throw error;
    }
  }

  async update(ownerUserId: string, agentId: string, input: UpdateAgentInput) {
    const existing = await this.findById(ownerUserId, agentId);
    if (!existing) return null;
    const now = Date.now();
    const nextRuntimeState =
      existing.type === "prime-figure" && "currentVariables" in input
        ? buildUpdatedPrimeState(
            await this.getRuntimeState<PrimeFigureState>(ownerUserId, agentId),
            input,
            now,
          )
        : undefined;
    const resourceInput = input as {
      avatar?: AgentResourceUpload | null;
      cover?: AgentResourceUpload | null;
    };
    let nextAvatar:
      Awaited<ReturnType<ResourceRepository["saveImage"]>> | null | undefined;
    let nextCover:
      Awaited<ReturnType<ResourceRepository["saveImage"]>> | null | undefined;
    let nextReferenceImages: PrimeFigureReferenceImage[] | undefined;
    let nextStickers: PrimeFigureSticker[] | undefined;
    try {
      nextAvatar =
        Object.prototype.hasOwnProperty.call(input, "avatar") &&
        resourceInput.avatar !== undefined
          ? resourceInput.avatar
            ? await this.resources.saveImage(
                ownerUserId,
                "agent_avatar",
                resourceInput.avatar,
              )
            : null
          : undefined;
      nextCover =
        Object.prototype.hasOwnProperty.call(input, "cover") &&
        resourceInput.cover !== undefined
          ? resourceInput.cover
            ? await this.resources.saveImage(
                ownerUserId,
                "agent_cover",
                resourceInput.cover,
              )
            : null
          : undefined;
      nextReferenceImages =
        existing.type === "prime-figure" &&
        "referenceImages" in input &&
        input.referenceImages !== undefined
          ? await this.resolveReferenceImages(
              ownerUserId,
              input.referenceImages,
              new Set(
                existing.detail.referenceImages.map((item) => item.resourceId),
              ),
            )
          : undefined;
      nextStickers =
        existing.type === "prime-figure" &&
        "stickers" in input &&
        input.stickers !== undefined
          ? await this.resolveStickers(
              ownerUserId,
              input.stickers,
              new Set(
                (existing.detail.stickers ?? []).map((item) => item.resourceId),
              ),
            )
          : undefined;
    } catch (error) {
      const existingReferenceIds =
        existing.type === "prime-figure"
          ? new Set(
              existing.detail.referenceImages.map((item) => item.resourceId),
            )
          : new Set<string>();
      const existingStickerIds =
        existing.type === "prime-figure"
          ? new Set(
              (existing.detail.stickers ?? []).map((item) => item.resourceId),
            )
          : new Set<string>();
      await this.deletePreparedResources(ownerUserId, [
        nextAvatar?.publicPath,
        nextCover?.publicPath,
        ...(nextReferenceImages ?? [])
          .filter((item) => !existingReferenceIds.has(item.resourceId))
          .map((item) => item.resourcePath),
        ...(nextStickers ?? [])
          .filter((item) => !existingStickerIds.has(item.resourceId))
          .map((item) => item.resourcePath),
      ]);
      throw error;
    }
    const definition = {
      ...existing,
      ...baseDefinition(input),
      detail: {
        ...buildDetail(
          existing.type,
          input,
          nextReferenceImages ??
            (existing.type === "prime-figure"
              ? existing.detail.referenceImages
              : []),
          nextStickers ??
            (existing.type === "prime-figure"
              ? (existing.detail.stickers ?? [])
              : []),
        ),
        ...(existing.type === "prime-figure"
          ? {
              voiceRequestStreaming:
                (input as UpdatePrimeFigureRequest).voiceRequestStreaming ??
                existing.detail.voiceRequestStreaming,
            }
          : {}),
      },
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
    try {
      await withTransaction(async (connection) => {
        if (nextRuntimeState) {
          await execute(
            "UPDATE agents SET name = ?, definition = ?, runtime_state = ?, is_public = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
            [
              input.name,
              JSON.stringify(definition),
              JSON.stringify(nextRuntimeState),
              input.isPublic,
              now,
              agentId,
              ownerUserId,
            ],
            connection,
          );
        } else {
          await execute(
            "UPDATE agents SET name = ?, definition = ?, is_public = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
            [
              input.name,
              JSON.stringify(definition),
              input.isPublic,
              now,
              agentId,
              ownerUserId,
            ],
            connection,
          );
        }
        await execute(
          "UPDATE conversations SET title = ?, updated_at = ? WHERE agent_id = ? AND owner_user_id = ?",
          [input.name, now, agentId, ownerUserId],
          connection,
        );
      });
    } catch (error) {
      await Promise.all([
        nextAvatar
          ? this.resources.deleteOwnedByPublicPath(
              ownerUserId,
              nextAvatar.publicPath,
            )
          : Promise.resolve(false),
        nextCover
          ? this.resources.deleteOwnedByPublicPath(
              ownerUserId,
              nextCover.publicPath,
            )
          : Promise.resolve(false),
        ...(nextReferenceImages ?? [])
          .filter(
            (item) =>
              !(
                existing.type === "prime-figure" &&
                existing.detail.referenceImages.some(
                  (current) => current.resourceId === item.resourceId,
                )
              ),
          )
          .map((item) =>
            this.resources.deleteOwnedByPublicPath(
              ownerUserId,
              item.resourcePath,
            ),
          ),
        ...(nextStickers ?? [])
          .filter(
            (item) =>
              !(
                existing.type === "prime-figure" &&
                (existing.detail.stickers ?? []).some(
                  (current) => current.resourceId === item.resourceId,
                )
              ),
          )
          .map((item) =>
            this.resources.deleteOwnedByPublicPath(
              ownerUserId,
              item.resourcePath,
            ),
          ),
      ]).catch(() => undefined);
      throw error;
    }
    await Promise.all([
      nextAvatar !== undefined &&
      existing.avatarResourcePath &&
      existing.avatarResourcePath !== nextAvatar?.publicPath
        ? this.resources.deleteOwnedByPublicPath(
            ownerUserId,
            existing.avatarResourcePath,
          )
        : Promise.resolve(false),
      nextCover !== undefined &&
      existing.coverResourcePath &&
      existing.coverResourcePath !== nextCover?.publicPath
        ? this.resources.deleteOwnedByPublicPath(
            ownerUserId,
            existing.coverResourcePath,
          )
        : Promise.resolve(false),
      ...(existing.type === "prime-figure" && nextReferenceImages !== undefined
        ? existing.detail.referenceImages
            .filter(
              (current) =>
                !nextReferenceImages.some(
                  (next) => next.resourceId === current.resourceId,
                ),
            )
            .map((current) =>
              this.resources.deleteOwnedByPublicPath(
                ownerUserId,
                current.resourcePath,
              ),
            )
        : []),
      // Sticker files can be referenced by historical messages. Removing an
      // item from the active library must not invalidate those messages.
    ]).catch((error) => console.warn("旧角色资源清理失败。", error));
    return this.findById(ownerUserId, agentId);
  }

  async updatePrimeFigurePreferences(
    ownerUserId: string,
    agentId: string,
    input: UpdatePrimeFigurePreferencesRequest,
  ) {
    const result = await execute(
      `UPDATE agents SET definition = JSON_SET(definition,
        '$.detail.voiceRequestStreaming', CAST(? AS JSON)), updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND type = 'prime-figure'`,
      [
        JSON.stringify(input.voiceRequestStreaming),
        Date.now(),
        agentId,
        ownerUserId,
      ],
    );
    if (!result.affectedRows) return null;
    return this.findById(ownerUserId, agentId);
  }

  async addPrimeFigureSticker(
    ownerUserId: string,
    agentId: string,
    input: { upload: AgentResourceUpload; description: string },
  ) {
    const saved = await this.resources.saveImage(
      ownerUserId,
      "prime_figure_sticker",
      input.upload,
    );
    const sticker: PrimeFigureSticker = {
      resourceId: saved.id,
      resourcePath: saved.publicPath,
      description: input.description.trim(),
    };
    try {
      const result = await execute(
        `UPDATE agents SET definition = JSON_SET(definition, '$.detail.stickers',
           JSON_ARRAY_APPEND(COALESCE(JSON_EXTRACT(definition, '$.detail.stickers'), JSON_ARRAY()), '$', CAST(? AS JSON))),
           updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND type = 'prime-figure'
           AND JSON_LENGTH(COALESCE(JSON_EXTRACT(definition, '$.detail.stickers'), JSON_ARRAY())) < 20`,
        [JSON.stringify(sticker), Date.now(), agentId, ownerUserId],
      );
      if (!result.affectedRows)
        throw new Error("本初角色不存在，或表情数量已达到 20 个上限。");
      return this.findById(ownerUserId, agentId);
    } catch (error) {
      await this.resources.deleteOwnedByPublicPath(
        ownerUserId,
        saved.publicPath,
      );
      throw error;
    }
  }

  async getPrimeFigureEditSnapshot(
    ownerUserId: string,
    agentId: string,
  ): Promise<PrimeFigureEditSnapshot | null> {
    const agent = await this.findById(ownerUserId, agentId);
    if (!agent || agent.type !== "prime-figure") return null;
    const state = await this.getRuntimeState<PrimeFigureState>(
      ownerUserId,
      agentId,
    );
    if (!state) return null;
    return {
      agent,
      state: {
        variables: state.variables ?? {},
        mood: state.mood ?? "",
        relationshipStatus: state.relationshipStatus ?? "",
      },
    };
  }

  async exportAgent(
    ownerUserId: string,
    agentId: string,
  ): Promise<AgentExportResponse | null> {
    const agent = await this.findById(ownerUserId, agentId);
    if (!agent || agent.type === "prime-world") return null;
    const avatar = await this.readUploadByPublicPath(
      ownerUserId,
      agent.avatarResourcePath,
    );
    const cover = await this.readUploadByPublicPath(
      ownerUserId,
      agent.coverResourcePath,
    );
    const base = {
      ...(avatar ? { avatar } : {}),
      ...(cover ? { cover } : {}),
      name: agent.name,
      attributes: agent.attributes,
      tags: agent.tags,
      introduction: agent.introduction,
      prologueHtml: agent.detail.prologueHtml,
      linkedAgentIds: agent.detail.linkedAgentIds,
      unlockConditions: agent.detail.unlockConditions ?? null,
      isPublic: agent.isPublic,
      persona: agent.detail.persona,
      background: agent.detail.background,
      personality: agent.detail.personality,
      responseStyle: agent.detail.responseStyle,
    };
    if (agent.type === "slice-figure") {
      return {
        data: {
          type: "slice-figure",
          ...base,
          currentSituation: agent.detail.currentSituation,
          openingLine: agent.detail.openingLine,
          systemPrompt: agent.detail.systemPrompt,
          memorySummaryPrompt: agent.detail.memorySummaryPrompt,
          replyAutoSegment: agent.detail.replyAutoSegment,
        },
      };
    }
    const state = await this.getRuntimeState<PrimeFigureState>(
      ownerUserId,
      agentId,
    );
    if (!state) return null;
    const referenceImages = await Promise.all(
      agent.detail.referenceImages.map(async (item) => {
        const resource = await this.resources.readForOwner(
          ownerUserId,
          item.resourceId,
        );
        if (!resource)
          throw new Error(`角色参考图片资源不存在：${item.resourceId}。`);
        return {
          description: item.description,
          upload: toResourceUpload(resource.record, resource.data),
        };
      }),
    );
    const stickers = await Promise.all(
      (agent.detail.stickers ?? []).map(async (item) => {
        const resource = await this.resources.readForOwner(
          ownerUserId,
          item.resourceId,
        );
        if (!resource)
          throw new Error(`角色表情资源不存在：${item.resourceId}。`);
        return {
          description: item.description,
          upload: toResourceUpload(resource.record, resource.data),
        };
      }),
    );
    return {
      data: {
        type: "prime-figure",
        ...base,
        decisionStyle: agent.detail.decisionStyle,
        currentSituation: agent.detail.currentSituation,
        schedule: agent.detail.schedule,
        itinerary: agent.detail.itinerary,
        variableDefinitions: agent.detail.variableDefinitions.map(
          (definition) => ({
            ...definition,
            ...(state.variables[definition.key] !== undefined
              ? { defaultValue: state.variables[definition.key] }
              : { defaultValue: undefined }),
          }),
        ),
        referenceImages,
        stickers,
        voiceRequestStreaming: agent.detail.voiceRequestStreaming,
        initialMood: state.mood,
        initialRelationshipStatus: state.relationshipStatus,
      },
    };
  }

  async getRuntimeState<T>(ownerUserId: string, agentId: string) {
    const row = await queryOne<AgentRow>(
      "SELECT runtime_state FROM agents WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, agentId],
    );
    return row ? parseJson<T>(row.runtime_state, {} as T) : null;
  }

  async saveRuntimeState(
    ownerUserId: string,
    agentId: string,
    state: unknown,
    nextRunAt?: number | null,
  ) {
    await execute(
      "UPDATE agents SET runtime_state = ?, next_run_at = ?, updated_at = ? WHERE owner_user_id = ? AND id = ?",
      [
        JSON.stringify(state),
        nextRunAt ?? null,
        Date.now(),
        ownerUserId,
        agentId,
      ],
    );
  }

  private async resolveReferenceImages(
    ownerUserId: string,
    inputs: PrimeFigureReferenceImageInput[],
    allowedExistingIds: Set<string>,
  ): Promise<PrimeFigureReferenceImage[]> {
    const result: PrimeFigureReferenceImage[] = [];
    const newlySavedPaths: string[] = [];
    try {
      for (const input of inputs) {
        if ("upload" in input && input.upload) {
          const saved = await this.resources.saveImage(
            ownerUserId,
            "prime_figure_reference",
            input.upload,
          );
          newlySavedPaths.push(saved.publicPath);
          result.push({
            resourceId: saved.id,
            resourcePath: saved.publicPath,
            description: input.description.trim(),
          });
          continue;
        }
        if (!allowedExistingIds.has(input.resourceId))
          throw new Error("不能引用其他角色的创作者图片资源。");
        const resource = await this.resources.findById(input.resourceId);
        if (
          !resource ||
          resource.ownerUserId !== ownerUserId ||
          resource.kind !== "prime_figure_reference" ||
          !resource.mimeType.startsWith("image/")
        )
          throw new Error("本初角色参考图片不存在或不属于当前用户。");
        result.push({
          resourceId: resource.id,
          resourcePath: resource.publicPath,
          description: input.description.trim(),
        });
      }
      return result;
    } catch (error) {
      await Promise.all(
        newlySavedPaths.map((path) =>
          this.resources.deleteOwnedByPublicPath(ownerUserId, path),
        ),
      ).catch(() => undefined);
      throw error;
    }
  }

  private async resolveStickers(
    ownerUserId: string,
    inputs: PrimeFigureStickerInput[],
    allowedExistingIds: Set<string>,
  ): Promise<PrimeFigureSticker[]> {
    if (inputs.length > 20)
      throw new Error("每个本初角色最多可添加 20 个表情。");
    const result: PrimeFigureSticker[] = [];
    const newlySavedPaths: string[] = [];
    try {
      for (const input of inputs) {
        if ("upload" in input && input.upload) {
          const saved = await this.resources.saveImage(
            ownerUserId,
            "prime_figure_sticker",
            input.upload,
          );
          newlySavedPaths.push(saved.publicPath);
          result.push({
            resourceId: saved.id,
            resourcePath: saved.publicPath,
            description: input.description.trim(),
          });
          continue;
        }
        if (!allowedExistingIds.has(input.resourceId))
          throw new Error("不能引用其他角色的表情资源。");
        const resource = await this.resources.findById(input.resourceId);
        if (
          !resource ||
          resource.ownerUserId !== ownerUserId ||
          resource.kind !== "prime_figure_sticker" ||
          !resource.mimeType.startsWith("image/")
        )
          throw new Error("本初角色表情不存在或不属于当前用户。");
        result.push({
          resourceId: resource.id,
          resourcePath: resource.publicPath,
          description: input.description.trim(),
        });
      }
      return result;
    } catch (error) {
      await Promise.all(
        newlySavedPaths.map((path) =>
          this.resources.deleteOwnedByPublicPath(ownerUserId, path),
        ),
      ).catch(() => undefined);
      throw error;
    }
  }

  private async deletePreparedResources(
    ownerUserId: string,
    paths: Array<string | null | undefined>,
  ) {
    await Promise.all(
      paths
        .filter((path): path is string => Boolean(path))
        .map((path) =>
          this.resources.deleteOwnedByPublicPath(ownerUserId, path),
        ),
    ).catch(() => undefined);
  }

  private async readUploadByPublicPath(
    ownerUserId: string,
    publicPath?: string,
  ) {
    if (!publicPath) return null;
    const record = await this.resources.findByPublicPath(
      ownerUserId,
      publicPath,
    );
    if (!record) throw new Error("角色图片资源不存在。");
    const resource = await this.resources.readForOwner(ownerUserId, record.id);
    return resource ? toResourceUpload(resource.record, resource.data) : null;
  }
}

const SELECT_AGENT = `SELECT agents.*, conversations.id AS conversation_id
  FROM agents LEFT JOIN conversations ON conversations.agent_id = agents.id`;

function rowToAgent(row: AgentRow): Agent {
  const stored = parseJson<
    Omit<
      Agent,
      "id" | "ownerUserId" | "conversationId" | "createdAt" | "updatedAt"
    >
  >(row.definition, {} as never);
  const runtimeState =
    row.type === "prime-figure"
      ? parseJson<PrimeFigureState>(row.runtime_state, {} as PrimeFigureState)
      : null;
  return {
    ...stored,
    ...(row.type === "prime-figure"
      ? {
          detail: {
            ...(stored as Extract<Agent, { type: "prime-figure" }>).detail,
            // Definitions created before reference-image support omitted this key.
            referenceImages:
              (stored as Extract<Agent, { type: "prime-figure" }>).detail
                ?.referenceImages ?? [],
            stickers:
              (stored as Extract<Agent, { type: "prime-figure" }>).detail
                ?.stickers ?? [],
            voiceRequestStreaming: Boolean(
              (stored as Extract<Agent, { type: "prime-figure" }>).detail
                ?.voiceRequestStreaming,
            ),
          },
        }
      : {}),
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

function buildDefinition(
  input: CreateAgentInput,
  avatar?: string,
  cover?: string,
  referenceImages: PrimeFigureReferenceImage[] = [],
  stickers: PrimeFigureSticker[] = [],
) {
  return {
    type: input.type,
    ...baseDefinition(input),
    ...(avatar ? { avatarResourcePath: avatar } : {}),
    ...(cover ? { coverResourcePath: cover } : {}),
    detail: buildDetail(input.type, input, referenceImages, stickers),
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

function buildDetail(
  type: Agent["type"],
  input: UpdateAgentInput | CreateAgentInput,
  referenceImages: PrimeFigureReferenceImage[],
  stickers: PrimeFigureSticker[],
) {
  if (type === "slice-figure") {
    const value = input as CreateSliceFigureRequest;
    return {
      prologueHtml: value.prologueHtml ?? "",
      currentSituation: value.currentSituation ?? "",
      openingLine: value.openingLine ?? "",
      linkedAgentIds: value.linkedAgentIds ?? [],
      ...(value.unlockConditions
        ? { unlockConditions: value.unlockConditions }
        : {}),
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
    ...(value.unlockConditions
      ? { unlockConditions: value.unlockConditions }
      : {}),
    persona: value.persona,
    background: value.background,
    personality: value.personality,
    responseStyle: value.responseStyle,
    decisionStyle: value.decisionStyle ?? "",
    currentSituation: value.currentSituation ?? "",
    schedule: { segments: value.schedule?.segments ?? [] },
    itinerary: value.itinerary ?? "",
    variableDefinitions: value.variableDefinitions ?? [],
    referenceImages,
    stickers,
    voiceRequestStreaming: value.voiceRequestStreaming ?? false,
  };
}

function buildRuntimeState(input: CreateAgentInput, now: number) {
  if (input.type !== "prime-figure") return {};
  const variables: Record<string, PrimeFigureVariableValue> = {};
  for (const definition of input.variableDefinitions ?? []) {
    if (definition.defaultValue !== undefined)
      variables[definition.key] = definition.defaultValue;
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
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildUpdatedPrimeState(
  current: PrimeFigureState | null,
  input: UpdatePrimeFigureRequest,
  now: number,
): PrimeFigureState {
  if (!current) throw new Error("本初角色运行状态不存在。");
  return {
    ...current,
    variables: validateCurrentVariables(
      input.variableDefinitions ?? [],
      input.currentVariables,
    ),
    mood: input.currentMood,
    moodObservedAtMs:
      input.currentMood === current.mood ? current.moodObservedAtMs : now,
    relationshipStatus: input.currentRelationshipStatus,
    updatedAt: now,
  };
}

function validateCurrentVariables(
  definitions: PrimeFigureVariableDefinition[],
  values: Record<string, PrimeFigureVariableValue>,
) {
  const result: Record<string, PrimeFigureVariableValue> = {};
  for (const definition of definitions) {
    const value = values[definition.key];
    if (value === undefined) continue;
    const valid =
      (definition.type === "string" && typeof value === "string") ||
      (definition.type === "number" &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        (definition.min === undefined || value >= definition.min) &&
        (definition.max === undefined || value <= definition.max)) ||
      (definition.type === "boolean" && typeof value === "boolean") ||
      (definition.type === "json" &&
        (value === null || typeof value === "object"));
    if (!valid) throw new Error(`参数 ${definition.key} 的当前值无效。`);
    result[definition.key] = value;
  }
  return result;
}

function toResourceUpload(
  record: { originalFileName: string; mimeType: string },
  data: Buffer,
): AgentResourceUpload {
  return {
    fileName: record.originalFileName,
    mimeType: record.mimeType,
    dataBase64: data.toString("base64"),
  };
}
