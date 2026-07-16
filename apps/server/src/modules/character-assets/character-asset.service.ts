import type {
  CharacterAssetSnapshot,
  PublishedRuntimeRecommendation,
} from "@echoo/shared";
import { AgentRepository } from "../agents/agent.repository.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import type {
  StoredFigureRuntimeConfig,
  StoredFishAudioConfig,
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

  listPublished(viewerUserId: string, limit?: number) {
    return this.assets.listPublished(viewerUserId, limit);
  }

  async getVisible(viewerUserId: string, assetId: string) {
    const asset = await this.assets.findVisible(viewerUserId, assetId);
    if (!asset) throw new CharacterAssetNotFoundError("未找到角色资产。");
    return asset;
  }

  async publish(
    ownerUserId: string,
    agentId: string,
    includeRecommendedRuntimeConfig: boolean,
  ) {
    const agent = await this.agents.findById(ownerUserId, agentId);
    if (!agent || agent.type === "prime-world")
      throw new CharacterAssetNotFoundError("未找到可发布的角色。");
    const { snapshot, resources } = await this.buildSnapshot(
      ownerUserId,
      agent,
    );
    let recommendation: PublishedRuntimeRecommendation | null = null;
    let warning: "CUSTOM_RUNTIME_CONFIG_REMOVED" | undefined;
    if (includeRecommendedRuntimeConfig) {
      const resolved = await this.runtimeConfigs.resolveConversationConfig(
        ownerUserId,
        agent.conversationId,
      );
      recommendation = sanitizeRuntimeRecommendation(
        agent.type,
        resolved.config,
      );
      if (!recommendation) warning = "CUSTOM_RUNTIME_CONFIG_REMOVED";
    }
    const published = await this.assets.publish({
      authorUserId: ownerUserId,
      sourceAgentId: agentId,
      snapshot,
      recommendedRuntimeConfig: recommendation,
      resources,
    });
    const asset = await this.assets.findVisible(ownerUserId, published.assetId);
    if (!asset) throw new Error("角色资产发布后读取失败。");
    return { asset, ...(warning ? { warning } : {}) };
  }

  async unlist(ownerUserId: string, assetId: string) {
    if (!(await this.assets.unlist(ownerUserId, assetId)))
      throw new CharacterAssetNotFoundError("未找到可下架的角色资产。");
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

  async updateInstallation(ownerUserId: string, assetId: string) {
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

function containsCustomSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsCustomSource);
  const record = value as Record<string, unknown>;
  if (record.source === "custom") return true;
  return Object.values(record).some(containsCustomSource);
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
