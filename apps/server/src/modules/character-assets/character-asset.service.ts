import {
  DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
  DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
  type CharacterAssetType,
  type CharacterAssetSnapshot,
  type CreateCharacterAssetDraftRequest,
  type CreatePrimeFigureRequest,
  type CreateSliceFigureRequest,
  type PrimeFigureReferenceImage,
  type PrimeFigureSticker,
  type PublishedRuntimeRecommendation,
} from "@echoo/shared";
import { AgentRepository } from "../agents/agent.repository.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import type {
  StoredFigureRuntimeConfig,
  StoredFishAudioConfig,
  StoredFishAudioSttConfig,
  StoredModelEndpointConfig,
  StoredPrimeFigureRuntimeConfig,
  StoredSliceFigureRuntimeConfig,
  StoredTextModelConfig,
} from "../runtime-config/runtime-config.types.js";
import {
  CharacterAssetRepository,
  type AssetResourceReference,
} from "./character-asset.repository.js";

export class CharacterAssetNotFoundError extends Error {}
export class CharacterAssetForbiddenError extends Error {}

export class CharacterAssetService {
  constructor(
    private readonly assets = new CharacterAssetRepository(),
    private readonly agents = new AgentRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly runtimeConfigs = new RuntimeConfigService(),
  ) {}

  listPublished(
    viewerUserId: string | null,
    input?: Parameters<CharacterAssetRepository["listPublished"]>[1],
  ) {
    return this.assets.listPublished(viewerUserId, input);
  }

  listPublishedByAuthor(
    viewerUserId: string | null,
    authorUserId: string,
    input?: { limit?: number; cursor?: string },
  ) {
    return this.assets.listPublishedByAuthor(viewerUserId, authorUserId, input);
  }

  listFollowing(
    viewerUserId: string,
    input?: { limit?: number; cursor?: string },
  ) {
    return this.assets.listFollowing(viewerUserId, input);
  }

  async getVisible(viewerUserId: string | null, assetId: string) {
    const asset = await this.assets.findVisible(viewerUserId, assetId);
    if (!asset) throw new CharacterAssetNotFoundError("未找到角色资产。");
    return asset;
  }

  listMine(ownerUserId: string) {
    return this.assets.listMine(ownerUserId);
  }

  async getDraft(ownerUserId: string, assetId: string) {
    const draft = await this.assets.findDraftForAuthor(ownerUserId, assetId);
    if (!draft) throw new CharacterAssetNotFoundError("未找到公共角色草稿。");
    return draft;
  }

  async createDraft(
    ownerUserId: string,
    input: CreateCharacterAssetDraftRequest,
  ) {
    let snapshot: CharacterAssetSnapshot;
    let resources: AssetResourceReference[] = [];
    if (typeof input.copyFromAgentId === "string") {
      const agent = await this.agents.findById(
        ownerUserId,
        input.copyFromAgentId,
      );
      if (!agent || agent.type === "prime-world")
        throw new CharacterAssetNotFoundError("未找到可拷贝的个人会话。");
      if (!agent.canPublishAsPublicAsset)
        throw new CharacterAssetForbiddenError(
          "从其他创作者的公共角色添加的会话不能再次发布。",
        );
      ({ snapshot, resources } = await this.buildSnapshot(ownerUserId, agent));
    } else {
      snapshot = createEmptySnapshot(input.type);
    }
    const defaults = await this.runtimeConfigs.getPlatformFigureDefaults(
      snapshot.type,
    );
    const recommendation = sanitizeRuntimeRecommendation(
      snapshot.type,
      defaults,
    );
    const assetId = await this.assets.createDraft({
      authorUserId: ownerUserId,
      snapshot,
      recommendedRuntimeConfig: recommendation,
      resources,
    });
    return this.getDraft(ownerUserId, assetId);
  }

  async saveDraftCharacter(
    ownerUserId: string,
    assetId: string,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest,
  ) {
    const draft = await this.getDraft(ownerUserId, assetId);
    if (draft.snapshot.type !== input.type)
      throw new CharacterAssetForbiddenError("公共角色类型不能修改。");
    const { snapshot, resources } = await this.buildDraftSnapshot(
      ownerUserId,
      draft.snapshot,
      input,
    );
    await this.assets.saveDraft({
      ownerUserId,
      assetId,
      snapshot,
      recommendedRuntimeConfig: draft.recommendedRuntimeConfig ?? null,
      resources,
    });
    return this.getDraft(ownerUserId, assetId);
  }

  async saveDraftRecommendation(
    ownerUserId: string,
    assetId: string,
    input: { enabled: boolean; config?: Record<string, unknown> },
  ) {
    const draft = await this.getDraft(ownerUserId, assetId);
    let recommendation: PublishedRuntimeRecommendation | null = null;
    if (input.enabled) {
      const raw =
        input.config ??
        (await this.runtimeConfigs.getPlatformFigureDefaults(
          draft.snapshot.type,
        ));
      const validated = await this.runtimeConfigs.validatePlatformFigureConfig(
        draft.snapshot.type,
        raw,
      );
      recommendation = sanitizeRuntimeRecommendation(
        draft.snapshot.type,
        validated,
      );
      if (!recommendation)
        throw new CharacterAssetForbiddenError("推荐配置只能使用平台模型。");
    }
    const resources = await this.snapshotResources(ownerUserId, draft.snapshot);
    await this.assets.saveDraft({
      ownerUserId,
      assetId,
      snapshot: draft.snapshot,
      recommendedRuntimeConfig: recommendation,
      resources,
    });
    return this.getDraft(ownerUserId, assetId);
  }

  async publishDraft(ownerUserId: string, assetId: string) {
    const published = await this.assets.publishDraft(ownerUserId, assetId);
    if (!published)
      throw new CharacterAssetForbiddenError("草稿没有可发布的修改。");
    const asset = await this.assets.findVisible(ownerUserId, assetId);
    if (!asset) throw new Error("公共角色发布后读取失败。");
    return { asset };
  }

  async unlist(ownerUserId: string, assetId: string) {
    if (!(await this.assets.unlist(ownerUserId, assetId)))
      throw new CharacterAssetNotFoundError("未找到可下架的角色资产。");
  }

  async deleteAsset(ownerUserId: string, assetId: string) {
    const result = await this.assets.deleteDeletable(ownerUserId, assetId);
    if (result === "not-found")
      throw new CharacterAssetNotFoundError("未找到要删除的公共角色。");
    if (result === "not-deletable")
      throw new CharacterAssetForbiddenError("请先下架公共角色，再彻底删除。");
  }

  async install(
    ownerUserId: string,
    assetId: string,
    applyRecommendedRuntimeConfig = false,
  ) {
    const asset = await this.assets.findVisible(ownerUserId, assetId);
    if (!asset || asset.status !== "published")
      throw new CharacterAssetNotFoundError("角色资产不存在或已下架。");
    const installation = await this.assets.createInstallation({
      ownerUserId,
      assetId,
      versionId: asset.latestVersion.id,
      snapshot: asset.latestVersion.snapshot,
      publicAssetPublishable: asset.author.id === ownerUserId,
    });
    if (!installation)
      throw new CharacterAssetNotFoundError("角色资产不存在或已下架。");
    const agent = await this.agents.findById(
      ownerUserId,
      installation.agent_id,
    );
    if (!agent) throw new Error("角色资产安装后读取失败。");
    if (
      applyRecommendedRuntimeConfig &&
      asset.latestVersion.recommendedRuntimeConfig
    )
      await this.runtimeConfigs.updateConversationConfig(
        ownerUserId,
        agent.conversationId,
        {
          mode: "custom",
          config: asset.latestVersion.recommendedRuntimeConfig.config,
        },
      );
    return {
      agent,
      installationId: installation.id,
      installedVersionId: installation.version_id,
    };
  }

  async updateInstallation(
    ownerUserId: string,
    assetId: string,
    applyRecommendedRuntimeConfig = false,
  ) {
    const [asset, installation] = await Promise.all([
      this.assets.findVisible(ownerUserId, assetId),
      this.assets.findInstallation(ownerUserId, assetId),
    ]);
    if (!asset || !installation)
      throw new CharacterAssetNotFoundError("未找到已添加的角色资产。");
    const agentId = await this.assets.updateInstallationToLatest({
      ownerUserId,
      installationId: installation.id,
      assetId,
      latestVersionId: asset.latestVersion.id,
      snapshot: asset.latestVersion.snapshot,
    });
    if (!agentId)
      throw new CharacterAssetNotFoundError("未找到已添加的角色资产。");
    const agent = await this.agents.findById(ownerUserId, agentId);
    if (!agent) throw new Error("角色资产更新后读取失败。");
    if (
      applyRecommendedRuntimeConfig &&
      asset.latestVersion.recommendedRuntimeConfig
    )
      await this.runtimeConfigs.updateConversationConfig(
        ownerUserId,
        agent.conversationId,
        {
          mode: "custom",
          config: asset.latestVersion.recommendedRuntimeConfig.config,
        },
      );
    return {
      agent,
      installationId: installation.id,
      installedVersionId: asset.latestVersion.id,
    };
  }

  private async buildSnapshot(
    ownerUserId: string,
    agent: Exclude<Awaited<ReturnType<AgentRepository["findById"]>>, null>,
  ): Promise<{
    snapshot: CharacterAssetSnapshot;
    resources: AssetResourceReference[];
  }> {
    if (agent.type === "prime-world")
      throw new CharacterAssetForbiddenError("本初世界暂不支持发布。");
    const references: AssetResourceReference[] = [];
    const avatar = agent.avatarResourcePath
      ? await this.resources.findByPublicPath(
          ownerUserId,
          agent.avatarResourcePath,
        )
      : null;
    const cover = agent.coverResourcePath
      ? await this.resources.findByPublicPath(
          ownerUserId,
          agent.coverResourcePath,
        )
      : null;
    if (avatar) references.push({ resourceId: avatar.id, usageKind: "avatar" });
    if (cover) references.push({ resourceId: cover.id, usageKind: "cover" });
    if (agent.type === "prime-figure") {
      references.push(
        ...agent.detail.referenceImages.map((image) => ({
          resourceId: image.resourceId,
          usageKind: "reference",
        })),
        ...(agent.detail.stickers ?? []).map((sticker) => ({
          resourceId: sticker.resourceId,
          usageKind: "sticker",
        })),
      );
    }
    const snapshot = {
      type: agent.type,
      name: agent.name,
      ...(avatar
        ? {
            avatarResourceId: avatar.id,
            avatarResourcePath: avatar.publicPath,
          }
        : {}),
      ...(cover
        ? {
            coverResourceId: cover.id,
            coverResourcePath: cover.publicPath,
          }
        : {}),
      attributes: structuredClone(agent.attributes),
      tags: [...agent.tags],
      introduction: agent.introduction,
      detail: structuredClone(agent.detail),
    } as CharacterAssetSnapshot;
    return { snapshot, resources: deduplicateReferences(references) };
  }

  private async snapshotResources(
    ownerUserId: string,
    snapshot: CharacterAssetSnapshot,
  ) {
    const resources: AssetResourceReference[] = [];
    const add = async (resourceId: string | undefined, usageKind: string) => {
      if (!resourceId) return;
      const resource = await this.resources.findById(resourceId);
      if (!resource || resource.ownerUserId !== ownerUserId)
        throw new CharacterAssetForbiddenError(
          "公共角色包含不可用的媒体资源。",
        );
      resources.push({ resourceId, usageKind });
    };
    await add(snapshot.avatarResourceId, "avatar");
    await add(snapshot.coverResourceId, "cover");
    if (snapshot.type === "prime-figure") {
      for (const image of snapshot.detail.referenceImages)
        await add(image.resourceId, "reference");
      for (const sticker of snapshot.detail.stickers ?? [])
        await add(sticker.resourceId, "sticker");
    }
    return deduplicateReferences(resources);
  }

  private async buildDraftSnapshot(
    ownerUserId: string,
    current: CharacterAssetSnapshot,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest,
  ) {
    const resolveCover = async (
      kind: "agent_avatar" | "agent_cover",
      upload: CreateSliceFigureRequest["avatar"],
      resourceId: string | undefined,
      resourcePath: string | undefined,
    ) => {
      if (upload === undefined)
        return resourceId && resourcePath ? { resourceId, resourcePath } : null;
      if (upload === null) return null;
      const saved = await this.resources.saveImage(ownerUserId, kind, upload);
      return { resourceId: saved.id, resourcePath: saved.publicPath };
    };
    const avatar = await resolveCover(
      "agent_avatar",
      input.avatar,
      current.avatarResourceId,
      current.avatarResourcePath,
    );
    const cover = await resolveCover(
      "agent_cover",
      input.cover,
      current.coverResourceId,
      current.coverResourcePath,
    );
    const resolveMedia = async (
      items: Array<{
        resourceId?: string;
        upload?: CreatePrimeFigureRequest["avatar"];
        description: string;
      }>,
      kind: "prime_figure_reference" | "prime_figure_sticker",
    ) => {
      const resolved: Array<PrimeFigureReferenceImage | PrimeFigureSticker> =
        [];
      for (const item of items) {
        const record = item.upload
          ? await this.resources.saveImage(ownerUserId, kind, item.upload)
          : item.resourceId
            ? await this.resources.findById(item.resourceId)
            : null;
        if (!record || record.ownerUserId !== ownerUserId)
          throw new CharacterAssetForbiddenError(
            "公共角色包含不可用的媒体资源。",
          );
        resolved.push({
          resourceId: record.id,
          resourcePath: record.publicPath,
          description: item.description,
        });
      }
      return resolved;
    };
    const base = {
      type: input.type,
      name: input.name,
      ...(avatar
        ? {
            avatarResourceId: avatar.resourceId,
            avatarResourcePath: avatar.resourcePath,
          }
        : {}),
      ...(cover
        ? {
            coverResourceId: cover.resourceId,
            coverResourcePath: cover.resourcePath,
          }
        : {}),
      attributes: structuredClone(input.attributes ?? []),
      tags: [...(input.tags ?? [])],
      introduction: input.introduction ?? "",
    };
    let snapshot: CharacterAssetSnapshot;
    if (input.type === "slice-figure") {
      snapshot = {
        ...base,
        type: "slice-figure",
        detail: {
          prologueHtml: input.prologueHtml ?? "",
          currentSituation: input.currentSituation ?? "",
          openingLine: input.openingLine ?? "",
          linkedAgentIds: input.linkedAgentIds ?? [],
          ...(input.unlockConditions
            ? { unlockConditions: input.unlockConditions }
            : {}),
          persona: input.persona,
          background: input.background,
          personality: input.personality,
          responseStyle: input.responseStyle,
          systemPrompt: input.systemPrompt,
          memorySummaryPrompt: input.memorySummaryPrompt,
        },
      };
    } else {
      const currentPrime = current as Extract<
        CharacterAssetSnapshot,
        { type: "prime-figure" }
      >;
      const referenceImages = (await resolveMedia(
        input.referenceImages ?? currentPrime.detail.referenceImages,
        "prime_figure_reference",
      )) as PrimeFigureReferenceImage[];
      const stickers = (await resolveMedia(
        input.stickers ?? currentPrime.detail.stickers ?? [],
        "prime_figure_sticker",
      )) as PrimeFigureSticker[];
      snapshot = {
        ...base,
        type: "prime-figure",
        detail: {
          prologueHtml: input.prologueHtml ?? "",
          linkedAgentIds: input.linkedAgentIds ?? [],
          ...(input.unlockConditions
            ? { unlockConditions: input.unlockConditions }
            : {}),
          persona: input.persona,
          background: input.background,
          personality: input.personality,
          responseStyle: input.responseStyle,
          decisionStyle: input.decisionStyle ?? "",
          currentSituation: input.currentSituation ?? "",
          schedule: input.schedule ?? { segments: [] },
          itinerary: input.itinerary ?? "",
          variableDefinitions: input.variableDefinitions ?? [],
          referenceImages,
          stickers,
          initialMood: input.initialMood ?? currentPrime.detail.initialMood,
          initialRelationshipStatus:
            input.initialRelationshipStatus ??
            currentPrime.detail.initialRelationshipStatus,
        },
      };
    }
    return {
      snapshot,
      resources: await this.snapshotResources(ownerUserId, snapshot),
    };
  }
}

export function sanitizeRuntimeRecommendation(
  characterType: "slice-figure" | "prime-figure",
  config: StoredFigureRuntimeConfig,
): PublishedRuntimeRecommendation | null {
  if (containsCustomSource(config)) return null;
  const publishedConfig =
    characterType === "slice-figure"
      ? sanitizeSliceConfig(config as StoredSliceFigureRuntimeConfig)
      : sanitizePrimeConfig(config as StoredPrimeFigureRuntimeConfig);
  return { version: 1, characterType, config: publishedConfig };
}

function sanitizeSliceConfig(config: StoredSliceFigureRuntimeConfig) {
  return {
    version: config.version,
    llm: sanitizeTextModel(config.llm),
    replyAutoSegment: config.replyAutoSegment,
    context: structuredClone(config.context),
  };
}

function sanitizePrimeConfig(config: StoredPrimeFigureRuntimeConfig) {
  return {
    version: config.version,
    decisionModel: sanitizeTextModel(config.decisionModel),
    outputs: {
      image: {
        enabled: config.outputs.image.enabled,
        guidanceLevel: config.outputs.image.guidanceLevel,
        generator: sanitizeModelEndpoint(config.outputs.image.generator),
        parameters: structuredClone(config.outputs.image.parameters),
      },
      voice: {
        enabled: config.outputs.voice.enabled,
        requestStreaming: config.outputs.voice.requestStreaming,
        autoPlay: config.outputs.voice.autoPlay,
        guidanceLevel: config.outputs.voice.guidanceLevel,
        tts: sanitizeFishAudio(config.outputs.voice.tts),
      },
      sticker: structuredClone(config.outputs.sticker),
      transfer: structuredClone(config.outputs.transfer),
    },
    optimization: {
      image: {
        enabled: config.optimization.image.enabled,
        level: config.optimization.image.level,
        model: sanitizeTextModel(config.optimization.image.model),
      },
      voice: {
        enabled: config.optimization.voice.enabled,
        level: config.optimization.voice.level,
        model: sanitizeTextModel(config.optimization.voice.model),
      },
    },
    understanding: {
      visual: {
        mode: config.understanding.visual.mode,
        model: sanitizeTextModel(config.understanding.visual.model),
      },
      audio: {
        mode: config.understanding.audio.mode,
        model: sanitizeTextModel(config.understanding.audio.model),
        stt: sanitizeFishAudioStt(config.understanding.audio.stt),
      },
    },
    context: structuredClone(config.context),
    typingCharsPerMinute: config.typingCharsPerMinute,
    messageCoalesceMs: config.messageCoalesceMs,
    wakeups: structuredClone(config.wakeups),
  };
}

function sanitizeModelEndpoint(config: StoredModelEndpointConfig) {
  return {
    source: "platform",
    ...(config.routingProvider
      ? { routingProvider: config.routingProvider }
      : {}),
    model: config.model,
  };
}

function sanitizeTextModel(config: StoredTextModelConfig) {
  return {
    ...sanitizeModelEndpoint(config),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

function sanitizeFishAudio(config: StoredFishAudioConfig) {
  return {
    source: "platform",
    referenceId: config.referenceId,
    model: config.model,
    latency: config.latency,
    chunkLength: config.chunkLength,
  };
}

function sanitizeFishAudioStt(config: StoredFishAudioSttConfig) {
  return {
    source: "platform" as const,
    ...(config.language ? { language: config.language } : {}),
  };
}

function containsCustomSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsCustomSource);
  const record = value as Record<string, unknown>;
  if (record.source === "custom") return true;
  return Object.values(record).some(containsCustomSource);
}

function createEmptySnapshot(type: CharacterAssetType): CharacterAssetSnapshot {
  const base = {
    type,
    name: "未命名公共角色",
    attributes: [],
    tags: [],
    introduction: "",
  };
  if (type === "slice-figure")
    return {
      ...base,
      type,
      detail: {
        prologueHtml: "",
        currentSituation: "",
        openingLine: "",
        linkedAgentIds: [],
        persona: "",
        background: "",
        personality: "",
        responseStyle: "",
        systemPrompt: DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
        memorySummaryPrompt: DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
      },
    };
  return {
    ...base,
    type,
    detail: {
      prologueHtml: "",
      linkedAgentIds: [],
      persona: "",
      background: "",
      personality: "",
      responseStyle: "",
      decisionStyle: "",
      currentSituation: "",
      schedule: { segments: [] },
      itinerary: "",
      variableDefinitions: [],
      referenceImages: [],
      stickers: [],
      initialMood: "",
      initialRelationshipStatus: "",
    },
  };
}

function deduplicateReferences(references: AssetResourceReference[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.resourceId}:${reference.usageKind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
