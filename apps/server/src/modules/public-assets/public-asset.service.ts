import {
  DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
  DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
  createDefaultPrimeWorldDetail,
  type CreatePrimeFigureRequest,
  type CreatePrimeWorldRequest,
  type CreateSliceFigureRequest,
  type PrimeFigureReferenceImage,
  type PrimeFigureSticker,
} from "@echoo/shared";
import type {
  CreatePublicAssetDraftRequest,
  PublicAssetSnapshot,
  PublicAssetType,
  PublishedRuntimeRecommendation,
} from "@echoo/shared/public-assets";
import { AgentRepository } from "../agents/agent.repository.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import type {
  StoredFigureRuntimeConfig,
  StoredFishAudioConfig,
  StoredFishAudioSttConfig,
  StoredModelEndpointConfig,
  StoredPrimeFigureRuntimeConfig,
  StoredPrimeWorldRuntimeConfig,
  StoredSliceFigureRuntimeConfig,
  StoredTextModelConfig,
} from "../runtime-config/runtime-config.types.js";
import { compilePrimeWorld } from "../agents/kinds/prime-world/prime-world-compiler.js";
import { collectPrimeWorldResourceIds } from "../agents/kinds/prime-world/prime-world-node-registry.js";
import { compilePrimeWorldJsonSchema } from "../agents/kinds/prime-world/prime-world-json-schema.js";
import { materializePrimeWorldBundle } from "../agents/kinds/prime-world/prime-world-bundle.js";
import {
  PublicAssetQueryError,
  PublicAssetRepository,
  type AssetResourceReference,
} from "./public-asset.repository.js";

export { PublicAssetQueryError };

export class PublicAssetNotFoundError extends Error {}
export class PublicAssetForbiddenError extends Error {}

export class PublicAssetService {
  constructor(
    private readonly assets = new PublicAssetRepository(),
    private readonly agents = new AgentRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly runtimeConfigs = new RuntimeConfigService(),
  ) {}

  listPublished(
    viewerUserId: string | null,
    input?: Parameters<PublicAssetRepository["listPublished"]>[1],
  ) {
    return this.assets.listPublished(viewerUserId, input);
  }

  listFeatured(viewerUserId: string | null, limit?: number) {
    return this.assets.listFeatured(viewerUserId, limit);
  }

  listPublishedByAuthor(
    viewerUserId: string | null,
    authorUserId: string,
    input?: Parameters<PublicAssetRepository["listPublishedByAuthor"]>[2],
  ) {
    return this.assets.listPublishedByAuthor(viewerUserId, authorUserId, input);
  }

  listFollowing(
    viewerUserId: string,
    input?: Parameters<PublicAssetRepository["listFollowing"]>[1],
  ) {
    return this.assets.listFollowing(viewerUserId, input);
  }

  async getVisible(viewerUserId: string | null, assetId: string) {
    const asset = await this.assets.findVisible(viewerUserId, assetId);
    if (!asset) throw new PublicAssetNotFoundError("未找到公共资产。");
    if (
      viewerUserId &&
      asset.snapshot.type === "prime-world" &&
      asset.installationId &&
      asset.updateAvailable
    ) {
      const installation = await this.assets.findInstallation(viewerUserId, assetId);
      const state = installation
        ? await this.agents.getRuntimeState<Record<string, unknown>>(
            viewerUserId,
            installation.agent_id,
          )
        : null;
      return {
        ...asset,
        worldProgressCompatibility: assessWorldProgressCompatibility(
          asset.snapshot,
          state,
        ),
      };
    }
    return asset;
  }

  listMine(ownerUserId: string) {
    return this.assets.listMine(ownerUserId);
  }

  async getDraft(ownerUserId: string, assetId: string) {
    const draft = await this.assets.findDraftForAuthor(ownerUserId, assetId);
    if (!draft) throw new PublicAssetNotFoundError("未找到公共资产草稿。");
    return draft;
  }

  async createDraft(
    ownerUserId: string,
    input: CreatePublicAssetDraftRequest,
  ) {
    let snapshot: PublicAssetSnapshot;
    let resources: AssetResourceReference[] = [];
    if (typeof input.importFromOriginalAgentId === "string") {
      const agent = await this.agents.findById(
        ownerUserId,
        input.importFromOriginalAgentId,
      );
      if (!agent)
        throw new PublicAssetNotFoundError("未找到可导入的原创会话。");
      if (agent.origin.kind !== "original")
        throw new PublicAssetForbiddenError(
          "从公共资产添加的会话不能再次发布，包括自己创建的公共资产。",
        );
      ({ snapshot, resources } = await this.buildSnapshot(ownerUserId, agent));
    } else {
      snapshot = createEmptySnapshot(input.type);
    }
    const assetId = await this.assets.createDraft({
      authorUserId: ownerUserId,
      snapshot,
      recommendedRuntimeConfig: null,
      resources,
    });
    return this.getDraft(ownerUserId, assetId);
  }

  async saveDraftContent(
    ownerUserId: string,
    assetId: string,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest | CreatePrimeWorldRequest,
  ) {
    const draft = await this.getDraft(ownerUserId, assetId);
    if (draft.snapshot.type !== input.type)
      throw new PublicAssetForbiddenError("公共资产类型不能修改。");
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

  async saveDraftBundle(ownerUserId: string, assetId: string, input: unknown) {
    const draft = await this.getDraft(ownerUserId, assetId);
    if (draft.snapshot.type !== "prime-world")
      throw new PublicAssetForbiddenError("只有本初世界草稿可以应用 bundle。");
    const materialized = await materializePrimeWorldBundle(
      ownerUserId,
      input,
      this.resources,
    );
    try {
      return await this.saveDraftContent(
        ownerUserId,
        assetId,
        materialized.request,
      );
    } catch (error) {
      await materialized.cleanup();
      throw error;
    }
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
        throw new PublicAssetForbiddenError("推荐配置只能使用平台模型。");
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
    const draft = await this.getDraft(ownerUserId, assetId);
    if (!draft.snapshot.name.trim())
      throw new PublicAssetForbiddenError(
        "请先填写名称并保存角色草稿，再发布公共资产。",
      );
    if (draft.snapshot.type === "prime-world") compilePrimeWorld(draft.snapshot.detail);
    const published = await this.assets.publishDraft(ownerUserId, assetId);
    if (!published)
      throw new PublicAssetForbiddenError("草稿没有可发布的修改。");
    const asset = await this.assets.findVisible(ownerUserId, assetId);
    if (!asset) throw new Error("公共资产发布后读取失败。");
    return { asset };
  }

  async unlist(ownerUserId: string, assetId: string) {
    if (!(await this.assets.unlist(ownerUserId, assetId)))
      throw new PublicAssetNotFoundError("未找到可下架的公共资产。");
  }

  async deleteAsset(ownerUserId: string, assetId: string) {
    const result = await this.assets.deleteDeletable(ownerUserId, assetId);
    if (result === "not-found")
      throw new PublicAssetNotFoundError("未找到要删除的公共资产。");
    if (result === "not-deletable")
      throw new PublicAssetForbiddenError("请先下架公共资产，再彻底删除。");
  }

  async install(
    ownerUserId: string,
    assetId: string,
    applyRecommendedRuntimeConfig = false,
  ) {
    const asset = await this.assets.findVisible(ownerUserId, assetId);
    if (!asset || asset.status !== "published")
      throw new PublicAssetNotFoundError("公共资产不存在或已下架。");
    const snapshot = snapshotForVersion(
      asset.latestVersion.snapshot,
      asset.latestVersion.versionNumber,
    );
    const installation = await this.assets.createInstallation({
      ownerUserId,
      assetId,
      versionId: asset.latestVersion.id,
      snapshot,
    });
    if (!installation)
      throw new PublicAssetNotFoundError("公共资产不存在或已下架。");
    const agent = await this.agents.findById(
      ownerUserId,
      installation.agent_id,
    );
    if (!agent) throw new Error("公共资产安装后读取失败。");
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
    worldProgressStrategy: "preserve-compatible" | "reset" = "reset",
  ) {
    const [asset, installation] = await Promise.all([
      this.assets.findVisible(ownerUserId, assetId),
      this.assets.findInstallation(ownerUserId, assetId),
    ]);
    if (!asset || !installation)
      throw new PublicAssetNotFoundError("未找到已添加的公共资产。");
    const snapshot = snapshotForVersion(
      asset.latestVersion.snapshot,
      asset.latestVersion.versionNumber,
    );
    if (snapshot.type === "prime-world") compilePrimeWorld(snapshot.detail);
    let agentId: string | null;
    try {
      agentId = await this.assets.updateInstallationToLatest({
      ownerUserId,
      installationId: installation.id,
      assetId,
      latestVersionId: asset.latestVersion.id,
        snapshot,
        worldProgressStrategy,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "PUBLIC_ASSET_WORLD_RUN_ACTIVE")
        throw new PublicAssetForbiddenError("世界正在运行，请等待本轮结束后再更新。");
      if (error instanceof Error && error.message === "PUBLIC_ASSET_WORLD_STATE_INCOMPATIBLE")
        throw new PublicAssetForbiddenError("当前世界进度与新版本不兼容，请选择重置进度。");
      throw error;
    }
    if (!agentId)
      throw new PublicAssetNotFoundError("未找到已添加的公共资产。");
    const agent = await this.agents.findById(ownerUserId, agentId);
    if (!agent) throw new Error("公共资产更新后读取失败。");
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
    snapshot: PublicAssetSnapshot;
    resources: AssetResourceReference[];
  }> {
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
    } else if (agent.type === "prime-world") {
      references.push(
        ...collectPrimeWorldResourceIds(
          agent.detail.workflow.nodes,
          agent.detail.presentation.startView,
        ).map((resourceId) => ({ resourceId, usageKind: "world" })),
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
    } as PublicAssetSnapshot;
    return { snapshot, resources: deduplicateReferences(references) };
  }

  private async snapshotResources(
    ownerUserId: string,
    snapshot: PublicAssetSnapshot,
  ) {
    const resources: AssetResourceReference[] = [];
    const add = async (resourceId: string | undefined, usageKind: string) => {
      if (!resourceId) return;
      const resource = await this.resources.findById(resourceId);
      if (!resource || resource.ownerUserId !== ownerUserId)
        throw new PublicAssetForbiddenError(
          "公共资产包含不可用的媒体资源。",
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
    } else if (snapshot.type === "prime-world") {
      for (const resourceId of collectPrimeWorldResourceIds(
        snapshot.detail.workflow.nodes,
        snapshot.detail.presentation.startView,
      ))
        await add(resourceId, "world");
    }
    return deduplicateReferences(resources);
  }

  private async buildDraftSnapshot(
    ownerUserId: string,
    current: PublicAssetSnapshot,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest | CreatePrimeWorldRequest,
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
          throw new PublicAssetForbiddenError(
            "公共资产包含不可用的媒体资源。",
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
    let snapshot: PublicAssetSnapshot;
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
    } else if (input.type === "prime-figure") {
      const currentPrime = current as Extract<
        PublicAssetSnapshot,
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
    } else {
      compilePrimeWorld(input.detail);
      snapshot = {
        ...base,
        type: "prime-world",
        detail: structuredClone(input.detail),
      };
    }
    return {
      snapshot,
      resources: await this.snapshotResources(ownerUserId, snapshot),
    };
  }
}

export function assessWorldProgressCompatibility(
  snapshot: Extract<PublicAssetSnapshot, { type: "prime-world" }>,
  state: Record<string, unknown> | null,
): { canPreserve: boolean; reason?: string } {
  if (!snapshot.detail.stateSchema)
    return {
      canPreserve: false,
      reason: "新版本没有声明状态结构，无法安全保留现有进度。",
    };
  if (!state || !state.variables || typeof state.variables !== "object")
    return {
      canPreserve: false,
      reason: "无法读取当前世界进度，只能重置到新版本。",
    };
  const validate = compilePrimeWorldJsonSchema(snapshot.detail.stateSchema);
  if (!validate(state.variables))
    return {
      canPreserve: false,
      reason: "当前世界进度不符合新版本的状态结构。",
    };
  return { canPreserve: true };
}

export function sanitizeRuntimeRecommendation(
  assetType: PublicAssetType,
  config: StoredFigureRuntimeConfig,
): PublishedRuntimeRecommendation | null {
  if (containsCustomSource(config)) return null;
  const publishedConfig = assetType === "slice-figure"
    ? sanitizeSliceConfig(config as StoredSliceFigureRuntimeConfig)
    : assetType === "prime-figure"
      ? sanitizePrimeConfig(config as StoredPrimeFigureRuntimeConfig)
      : sanitizeWorldConfig(config as StoredPrimeWorldRuntimeConfig);
  return { version: 1, assetType, config: publishedConfig };
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

function sanitizeWorldConfig(config: StoredPrimeWorldRuntimeConfig) {
  return {
    version: config.version,
    mainModel: sanitizeTextModel(config.mainModel),
    summaryModel: sanitizeTextModel(config.summaryModel),
    stt: sanitizeFishAudioStt(config.stt),
    tts: sanitizeFishAudio(config.tts),
    context: structuredClone(config.context),
    audio: structuredClone(config.audio),
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

function createEmptySnapshot(type: PublicAssetType): PublicAssetSnapshot {
  const base = {
    type,
    name: type === "prime-world" ? "未命名本初世界" : "未命名公共资产",
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
  if (type === "prime-figure") return {
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
  return {
    ...base,
    type: "prime-world",
    detail: createDefaultPrimeWorldDetail(),
  };
}

function snapshotForVersion(snapshot: PublicAssetSnapshot, versionNumber: number) {
  const next = structuredClone(snapshot);
  if (next.type === "prime-world") next.detail.definitionRevision = versionNumber;
  return next;
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
