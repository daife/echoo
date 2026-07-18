import { randomUUID } from "node:crypto";
import type {
  AgentType,
  ConversationRuntimeConfigPatchRequest,
  ConversationRuntimeConfigResponse,
  FishAudioConfigPatch,
  FishAudioSttConfigPatch,
  ModelEndpointConfigPatch,
  PrimeFigureRuntimeConfigPatch,
  SliceFigureRuntimeConfigPatch,
  UserRuntimeConfigPatch,
  UserRuntimeConfigView,
} from "@echoo/shared";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { PrimeFigureStateRepository } from "../agents/kinds/prime-figure/prime-figure-state.repository.js";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import { RuntimeConfigRepository } from "./runtime-config.repository.js";
import { PlatformCatalogService } from "../platform-catalog/platform-catalog.service.js";
import { environment } from "../../infra/config/environment.js";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service.js";
import {
  isPlatformDeepSeekRoute,
  PLATFORM_DEEPSEEK_BASE_URL,
} from "../ai/platform-deepseek.js";
import type {
  StoredFigureRuntimeConfig,
  StoredFishAudioConfig,
  StoredFishAudioSttConfig,
  StoredModelEndpointConfig,
  StoredPrimeFigureRuntimeConfig,
  StoredRuntimeConfigPresets,
  StoredSliceFigureRuntimeConfig,
  StoredTextModelConfig,
  StoredUserRuntimeConfig,
} from "./runtime-config.types.js";

export class RuntimeConfigNotFoundError extends Error {}
export class RuntimeConfigValidationError extends Error {}

export class RuntimeConfigService {
  constructor(
    private readonly repository = new RuntimeConfigRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly primeStates = new PrimeFigureStateRepository(),
    private readonly catalog = new PlatformCatalogService(),
    private readonly platformSettings = new PlatformSettingsService(),
  ) {}

  async getUserConfig(ownerUserId: string): Promise<UserRuntimeConfigView> {
    const [config, presets] = await Promise.all([
      this.ensureUserConfig(ownerUserId),
      this.readRuntimeConfigPresets(),
    ]);
    return { ...redactUserConfig(config), presets: redactPresets(presets) };
  }

  async initializeUserConfig(ownerUserId: string) {
    const defaults = await this.readNewUserDefaults();
    await this.repository.insertUserConfigIfAbsent(ownerUserId, defaults);
  }

  async getPlatformFigureDefaults(type: "slice-figure" | "prime-figure") {
    const defaults = await this.readNewUserDefaults();
    return structuredClone(
      type === "slice-figure" ? defaults.sliceFigure : defaults.primeFigure,
    ) as StoredFigureRuntimeConfig;
  }

  async validatePlatformFigureConfig(
    type: "slice-figure" | "prime-figure",
    config: unknown,
  ) {
    const normalized = forcePlatformPreset(
      type,
      config as StoredSliceFigureRuntimeConfig | StoredPrimeFigureRuntimeConfig,
    );
    validateFigureConfig(
      type,
      normalized as
        StoredSliceFigureRuntimeConfig | StoredPrimeFigureRuntimeConfig,
    );
    await this.validateCatalogFigure(type, normalized);
    return normalized;
  }

  async getAdminRuntimeDefaults() {
    const [stored, presets] = await Promise.all([
      this.platformSettings.getNewUserRuntimeDefaults(),
      this.readRuntimeConfigPresets(),
    ]);
    const config = this.normalizePlatformDefaults(stored.config);
    return {
      config: redactUserConfig(config),
      presets: redactPresets(presets),
      updatedAt: stored.updatedAt,
    };
  }

  async updateAdminRuntimeDefaults(patch: UserRuntimeConfigPatch) {
    const current = await this.readNewUserDefaults();
    const next = forcePlatformDefaults({
      ...current,
      sliceFigure: patch.sliceFigure
        ? patchSliceConfig(current.sliceFigure, patch.sliceFigure)
        : current.sliceFigure,
      primeFigure: patch.primeFigure
        ? patchPrimeConfig(current.primeFigure, patch.primeFigure)
        : current.primeFigure,
    });
    validateUserConfig(next);
    const warnings = await this.validateCatalogUser(next);
    const saved = await this.platformSettings.setNewUserRuntimeDefaults(next);
    return {
      config: {
        ...redactUserConfig(saved.config),
        ...(warnings.length ? { warnings } : {}),
      },
      presets: redactPresets(await this.readRuntimeConfigPresets()),
      updatedAt: saved.updatedAt,
    };
  }

  async createAdminRuntimePreset(
    type: "slice-figure" | "prime-figure",
    name: string,
  ) {
    const presets = await this.readRuntimeConfigPresets();
    const defaults = await this.readNewUserDefaults();
    const presetName = normalizePresetName(name);
    if (type === "slice-figure")
      presets.sliceFigure.push({
        id: randomUUID(),
        name: presetName,
        config: structuredClone(defaults.sliceFigure),
      });
    else
      presets.primeFigure.push({
        id: randomUUID(),
        name: presetName,
        config: structuredClone(defaults.primeFigure),
      });
    await this.platformSettings.setRuntimeConfigPresets(presets);
    return redactPresets(presets);
  }

  async updateAdminRuntimePreset(
    type: "slice-figure" | "prime-figure",
    presetId: string,
    input: {
      name?: string;
      config?: SliceFigureRuntimeConfigPatch | PrimeFigureRuntimeConfigPatch;
    },
  ) {
    const presets = await this.readRuntimeConfigPresets();
    if (type === "slice-figure") {
      const preset = presets.sliceFigure.find((item) => item.id === presetId);
      if (!preset) throw new RuntimeConfigNotFoundError("未找到该推荐配置。");
      if (input.name !== undefined)
        preset.name = normalizePresetName(input.name);
      if (input.config) {
        preset.config = forcePlatformPreset(
          type,
          patchSliceConfig(
            preset.config,
            input.config as SliceFigureRuntimeConfigPatch,
          ),
        ) as StoredSliceFigureRuntimeConfig;
        validateFigureConfig(type, preset.config);
        await this.validateCatalogFigure(type, preset.config);
      }
    } else {
      const preset = presets.primeFigure.find((item) => item.id === presetId);
      if (!preset) throw new RuntimeConfigNotFoundError("未找到该推荐配置。");
      if (input.name !== undefined)
        preset.name = normalizePresetName(input.name);
      if (input.config) {
        preset.config = forcePlatformPreset(
          type,
          patchPrimeConfig(
            preset.config,
            input.config as PrimeFigureRuntimeConfigPatch,
          ),
        ) as StoredPrimeFigureRuntimeConfig;
        validateFigureConfig(type, preset.config);
        await this.validateCatalogFigure(type, preset.config);
      }
    }
    await this.platformSettings.setRuntimeConfigPresets(presets);
    return redactPresets(presets);
  }

  async deleteAdminRuntimePreset(
    type: "slice-figure" | "prime-figure",
    presetId: string,
  ) {
    const presets = await this.readRuntimeConfigPresets();
    if (type === "slice-figure") {
      const next = presets.sliceFigure.filter((item) => item.id !== presetId);
      if (next.length === presets.sliceFigure.length)
        throw new RuntimeConfigNotFoundError("未找到该推荐配置。");
      presets.sliceFigure = next;
    } else {
      const next = presets.primeFigure.filter((item) => item.id !== presetId);
      if (next.length === presets.primeFigure.length)
        throw new RuntimeConfigNotFoundError("未找到该推荐配置。");
      presets.primeFigure = next;
    }
    await this.platformSettings.setRuntimeConfigPresets(presets);
    return redactPresets(presets);
  }

  async updateUserConfig(
    ownerUserId: string,
    patch: UserRuntimeConfigPatch,
  ): Promise<UserRuntimeConfigView> {
    const current = await this.ensureUserConfig(ownerUserId);
    const next: StoredUserRuntimeConfig = {
      ...current,
      sliceFigure: patch.sliceFigure
        ? patchSliceConfig(current.sliceFigure, patch.sliceFigure)
        : current.sliceFigure,
      primeFigure: patch.primeFigure
        ? patchPrimeConfig(current.primeFigure, patch.primeFigure)
        : current.primeFigure,
    };
    validateUserConfig(next);
    const warnings = await this.validateCatalogUser(next);
    await this.repository.saveUserConfig(ownerUserId, next);
    const disabled = disabledWakeups(current.primeFigure, next.primeFigure);
    await this.primeStates.clearDisabledWakeupsForOwner({
      ownerUserId,
      ...disabled,
    });
    return {
      ...redactUserConfig(next),
      presets: redactPresets(await this.readRuntimeConfigPresets()),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  async getConversationConfig(
    ownerUserId: string,
    conversationId: string,
  ): Promise<ConversationRuntimeConfigResponse> {
    try {
      const resolved = await this.resolveStoredConversationConfig(
        ownerUserId,
        conversationId,
      );
      return {
        mode: resolved.mode,
        conversationType: resolved.conversationType,
        config: redactFigureConfig(resolved.config),
        presets: selectRedactedPresets(
          await this.readRuntimeConfigPresets(),
          resolved.conversationType,
        ),
      };
    } catch (error) {
      if (!isRecoverableStoredConfigError(error)) throw error;
      const selection = await this.repository.findConversationConfigSelection(
        ownerUserId,
        conversationId,
      );
      if (!selection || !isAgentType(selection.conversationType))
        throw new RuntimeConfigNotFoundError("未找到可配置的角色会话。");
      return {
        mode:
          selection.mode === "custom" && selection.hasCustomConfig
            ? "custom"
            : "global",
        conversationType: selection.conversationType,
        validationError:
          error instanceof Error ? error.message : "当前运行配置无效。",
      };
    }
  }

  async updateConversationConfig(
    ownerUserId: string,
    conversationId: string,
    input: ConversationRuntimeConfigPatchRequest,
  ): Promise<ConversationRuntimeConfigResponse> {
    const conversation = await this.requireFigureConversation(
      ownerUserId,
      conversationId,
    );
    const global = selectFigureConfig(
      await this.ensureUserConfig(ownerUserId),
      conversation.type,
    );
    const stored = await this.repository.findConversationConfig(
      ownerUserId,
      conversationId,
    );
    const storedCustom = stored?.customConfig ?? null;
    let custom: StoredFigureRuntimeConfig | null = null;
    let previousConfig: StoredFigureRuntimeConfig = global;
    if (input.mode === "custom") {
      custom = storedCustom ? storedCustom : structuredClone(global);
      if (stored?.mode === "custom") previousConfig = custom;
      if (input.config)
        custom = patchFigureConfig(conversation.type, custom, input.config);
      validateFigureConfig(conversation.type, custom);
    }
    const nextConfig = input.mode === "custom" ? custom! : global;
    validateFigureConfig(conversation.type, nextConfig);
    const isConfigUpdate = input.mode === "custom" && Boolean(input.config);
    const warnings = isConfigUpdate
      ? await this.validateCatalogFigure(conversation.type, nextConfig)
      : [];
    await this.repository.saveConversationConfig({
      ownerUserId,
      conversationId,
      mode: input.mode,
      customConfig: input.mode === "custom" ? custom : storedCustom,
    });
    if (conversation.type === "prime-figure") {
      const nextPrimeConfig = nextConfig as StoredPrimeFigureRuntimeConfig;
      const disabled = isConfigUpdate
        ? disabledWakeups(
            previousConfig as StoredPrimeFigureRuntimeConfig,
            nextPrimeConfig,
          )
        : {
            proactive: !nextPrimeConfig.wakeups.proactive.enabled,
            passive: !nextPrimeConfig.wakeups.passive.enabled,
          };
      await this.primeStates.clearDisabledWakeupsForConversation({
        ownerUserId,
        conversationId,
        ...disabled,
      });
    }
    return {
      mode: input.mode,
      conversationType: conversation.type,
      config: redactFigureConfig(input.mode === "custom" ? custom! : global),
      presets: selectRedactedPresets(
        await this.readRuntimeConfigPresets(),
        conversation.type,
      ),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  async resolveConversationConfig(
    ownerUserId: string,
    conversationId: string,
  ): Promise<{
    mode: "global" | "custom";
    conversationType: AgentType;
    config: StoredFigureRuntimeConfig;
  }> {
    const resolved = await this.resolveStoredConversationConfig(
      ownerUserId,
      conversationId,
    );
    return {
      ...resolved,
      config: resolvePlatformFigureConfig(resolved.config),
    };
  }

  private async resolveStoredConversationConfig(
    ownerUserId: string,
    conversationId: string,
  ): Promise<{
    mode: "global" | "custom";
    conversationType: AgentType;
    config: StoredFigureRuntimeConfig;
  }> {
    let stored = await this.repository.findResolvedConversationConfig(
      ownerUserId,
      conversationId,
    );
    if (!stored || !isAgentType(stored.conversationType))
      throw new RuntimeConfigNotFoundError("未找到可配置的角色会话。");
    if (!stored.userConfig) {
      await this.initializeUserConfig(ownerUserId);
      stored = await this.repository.findResolvedConversationConfig(
        ownerUserId,
        conversationId,
      );
    }
    if (!stored?.userConfig)
      throw new RuntimeConfigNotFoundError("无法初始化用户运行配置。");
    const userConfig = stored.userConfig;
    validateUserConfig(userConfig);
    const conversationType = stored.conversationType as AgentType;
    const global = selectFigureConfig(userConfig, conversationType);
    const custom = stored.customConfig;
    const mode = stored?.mode === "custom" && custom ? "custom" : "global";
    const config = mode === "custom" ? custom! : global;
    validateFigureConfig(conversationType, config);
    return { mode, conversationType, config };
  }

  private async ensureUserConfig(ownerUserId: string) {
    const existing = await this.repository.findUserConfig(ownerUserId);
    if (existing) {
      validateUserConfig(existing);
      return existing;
    }
    await this.repository.insertUserConfigIfAbsent(
      ownerUserId,
      await this.readNewUserDefaults(),
    );
    const created = await this.repository.findUserConfig(ownerUserId);
    if (!created)
      throw new RuntimeConfigNotFoundError("无法初始化用户运行配置。");
    return created;
  }

  private async readNewUserDefaults() {
    const stored = await this.platformSettings.getNewUserRuntimeDefaults();
    return this.normalizePlatformDefaults(stored.config);
  }

  private async readRuntimeConfigPresets(): Promise<StoredRuntimeConfigPresets> {
    const stored =
      typeof this.platformSettings.getRuntimeConfigPresets === "function"
        ? await this.platformSettings.getRuntimeConfigPresets()
        : { sliceFigure: [], primeFigure: [] };
    const normalized: StoredRuntimeConfigPresets = {
      sliceFigure: [],
      primeFigure: [],
    };
    for (const preset of stored.sliceFigure ?? []) {
      try {
        const config = forcePlatformPreset("slice-figure", preset.config);
        validateFigureConfig("slice-figure", config);
        normalized.sliceFigure.push({
          id: String(preset.id),
          name: normalizePresetName(preset.name),
          config: config as StoredSliceFigureRuntimeConfig,
        });
      } catch (error) {
        console.warn("Ignoring invalid slice runtime preset.", error);
      }
    }
    for (const preset of stored.primeFigure ?? []) {
      try {
        const config = forcePlatformPreset("prime-figure", preset.config);
        validateFigureConfig("prime-figure", config);
        normalized.primeFigure.push({
          id: String(preset.id),
          name: normalizePresetName(preset.name),
          config: config as StoredPrimeFigureRuntimeConfig,
        });
      } catch (error) {
        console.warn("Ignoring invalid prime runtime preset.", error);
      }
    }
    return normalized;
  }

  private normalizePlatformDefaults(config: StoredUserRuntimeConfig) {
    try {
      const normalized = forcePlatformDefaults(config);
      validateUserConfig(normalized);
      return normalized;
    } catch (error) {
      console.warn(
        "Stored new-user runtime defaults are invalid; using built-in defaults.",
        error,
      );
      return forcePlatformDefaults(buildRuntimeConfigDefaults());
    }
  }

  private async requireFigureConversation(
    ownerUserId: string,
    conversationId: string,
  ) {
    const conversation = await this.conversations.findByIdForOwner(
      ownerUserId,
      conversationId,
    );
    if (!conversation || !isAgentType(conversation.type))
      throw new RuntimeConfigNotFoundError("未找到可配置的角色会话。");
    return { ...conversation, type: conversation.type };
  }

  private async validateCatalogUser(config: StoredUserRuntimeConfig) {
    try {
      return await this.catalog.validateUserConfig(config);
    } catch (error) {
      throw new RuntimeConfigValidationError(
        error instanceof Error ? error.message : "模型能力校验失败。",
      );
    }
  }

  private async validateCatalogFigure(
    type: AgentType,
    config: StoredFigureRuntimeConfig,
  ) {
    try {
      return await this.catalog.validateFigureConfig(type, config);
    } catch (error) {
      throw new RuntimeConfigValidationError(
        error instanceof Error ? error.message : "模型能力校验失败。",
      );
    }
  }
}

function disabledWakeups(
  previous: StoredPrimeFigureRuntimeConfig,
  next: StoredPrimeFigureRuntimeConfig,
) {
  return {
    proactive:
      previous.wakeups.proactive.enabled && !next.wakeups.proactive.enabled,
    passive: previous.wakeups.passive.enabled && !next.wakeups.passive.enabled,
  };
}

export function forcePlatformDefaults(
  config: StoredUserRuntimeConfig,
): StoredUserRuntimeConfig {
  const endpoint = <T extends StoredModelEndpointConfig>(value: T): T => ({
    ...value,
    source: "platform",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
  });
  const prime = config.primeFigure;
  return {
    ...config,
    sliceFigure: {
      ...config.sliceFigure,
      llm: endpoint(config.sliceFigure.llm),
    },
    primeFigure: {
      ...prime,
      decisionModel: endpoint(prime.decisionModel),
      outputs: {
        ...prime.outputs,
        image: {
          ...prime.outputs.image,
          generator: endpoint(prime.outputs.image.generator),
        },
        voice: {
          ...prime.outputs.voice,
          tts: {
            ...prime.outputs.voice.tts,
            source: "platform",
            apiKey: "",
            httpUrl: "https://api.fish.audio/v1/tts",
            wsUrl: "wss://api.fish.audio/v1/tts/live",
          },
        },
      },
      optimization: {
        image: {
          ...prime.optimization.image,
          model: endpoint(prime.optimization.image.model),
        },
        voice: {
          ...prime.optimization.voice,
          model: endpoint(prime.optimization.voice.model),
        },
      },
      understanding: {
        visual: {
          ...prime.understanding.visual,
          model: endpoint(prime.understanding.visual.model),
        },
        audio: {
          ...prime.understanding.audio,
          model: endpoint(prime.understanding.audio.model),
          stt: {
            ...prime.understanding.audio.stt,
            source: "platform",
            apiKey: "",
            httpUrl: "https://api.fish.audio/v1/asr",
          },
        },
      },
    },
  };
}

function forcePlatformPreset(
  type: "slice-figure" | "prime-figure",
  config: StoredSliceFigureRuntimeConfig | StoredPrimeFigureRuntimeConfig,
) {
  const defaults = buildRuntimeConfigDefaults();
  const wrapped: StoredUserRuntimeConfig = {
    ...defaults,
    ...(type === "slice-figure"
      ? { sliceFigure: config as StoredSliceFigureRuntimeConfig }
      : { primeFigure: config as StoredPrimeFigureRuntimeConfig }),
  };
  return selectFigureConfig(forcePlatformDefaults(wrapped), type) as
    StoredSliceFigureRuntimeConfig | StoredPrimeFigureRuntimeConfig;
}

function normalizePresetName(name: string) {
  const value = String(name ?? "").trim();
  if (!value) invalid("推荐配置名称不能为空。");
  if (value.length > 80) invalid("推荐配置名称不能超过 80 个字符。");
  return value;
}

function patchSliceConfig(
  current: StoredSliceFigureRuntimeConfig,
  patch: SliceFigureRuntimeConfigPatch,
): StoredSliceFigureRuntimeConfig {
  return {
    ...current,
    version: 3,
    llm: patch.llm ? patchTextModel(current.llm, patch.llm) : current.llm,
    replyAutoSegment: patch.replyAutoSegment ?? current.replyAutoSegment,
    context: { ...current.context, ...patch.context },
  };
}

function patchPrimeConfig(
  current: StoredPrimeFigureRuntimeConfig,
  patch: PrimeFigureRuntimeConfigPatch,
): StoredPrimeFigureRuntimeConfig {
  const audioUnderstanding = patch.understanding?.audio;
  const imageGenerator = patch.outputs?.image?.generator
    ? patchEndpoint(
        current.outputs.image.generator,
        patch.outputs.image.generator,
      )
    : current.outputs.image.generator;
  const imageEndpointChanged = Boolean(
    patch.outputs?.image?.generator?.model !== undefined ||
    patch.outputs?.image?.generator?.source !== undefined,
  );
  return {
    ...current,
    version: 9,
    decisionModel: patch.decisionModel
      ? patchTextModel(current.decisionModel, patch.decisionModel)
      : current.decisionModel,
    outputs: {
      image: {
        ...current.outputs.image,
        ...patch.outputs?.image,
        generator: imageGenerator,
        parameters:
          patch.outputs?.image?.parameters ??
          (imageEndpointChanged
            ? normalizeImageParameters(imageGenerator, undefined)
            : current.outputs.image.parameters),
      },
      voice: {
        ...current.outputs.voice,
        ...patch.outputs?.voice,
        tts: patch.outputs?.voice?.tts
          ? patchFishAudio(current.outputs.voice.tts, patch.outputs.voice.tts)
          : current.outputs.voice.tts,
      },
      sticker: {
        ...current.outputs.sticker,
        ...patch.outputs?.sticker,
      },
      transfer: {
        ...current.outputs.transfer,
        ...patch.outputs?.transfer,
      },
    },
    optimization: {
      image: patchPrimeModelFeature(
        current.optimization.image,
        patch.optimization?.image,
      ),
      voice: patchPrimeModelFeature(
        current.optimization.voice,
        patch.optimization?.voice,
      ),
    },
    understanding: {
      visual: patchPrimeModelFeature(
        current.understanding.visual,
        patch.understanding?.visual,
      ),
      audio: {
        ...current.understanding.audio,
        ...(audioUnderstanding?.mode ? { mode: audioUnderstanding.mode } : {}),
        model: audioUnderstanding?.model
          ? patchTextModel(
              current.understanding.audio.model,
              audioUnderstanding.model,
            )
          : current.understanding.audio.model,
        stt: audioUnderstanding?.stt
          ? patchFishAudioStt(
              current.understanding.audio.stt,
              audioUnderstanding.stt,
            )
          : current.understanding.audio.stt,
      },
    },
    context: { ...current.context, ...patch.context },
    typingCharsPerMinute:
      patch.typingCharsPerMinute ?? current.typingCharsPerMinute,
    messageCoalesceMs: patch.messageCoalesceMs ?? current.messageCoalesceMs,
    wakeups: {
      proactive: {
        ...current.wakeups.proactive,
        ...patch.wakeups?.proactive,
      },
      passive: {
        ...current.wakeups.passive,
        ...patch.wakeups?.passive,
      },
    },
  };
}

function patchPrimeModelFeature<
  T extends { model: StoredTextModelConfig },
  P extends Partial<Omit<T, "model">> & { model?: ModelEndpointConfigPatch },
>(current: T, patch?: P): T {
  if (!patch) return current;
  return {
    ...current,
    ...patch,
    model: patch.model
      ? patchTextModel(current.model, patch.model)
      : current.model,
  } as T;
}

function patchTextModel(
  current: StoredTextModelConfig,
  patch: ModelEndpointConfigPatch & {
    temperature?: number;
    maxTokens?: number;
  },
): StoredTextModelConfig {
  return {
    ...patchEndpoint(current, patch),
    temperature: patch.temperature ?? current.temperature,
    maxTokens: patch.maxTokens ?? current.maxTokens,
  };
}

function patchEndpoint<T extends StoredModelEndpointConfig>(
  current: T,
  patch: ModelEndpointConfigPatch,
): T {
  const next = {
    ...current,
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey ?? "" } : {}),
  } as T;
  if (patch.routingProvider === null) delete next.routingProvider;
  else if (patch.routingProvider !== undefined)
    next.routingProvider = patch.routingProvider;
  if (next.source === "custom") delete next.routingProvider;
  return next;
}

function patchFishAudio(
  current: StoredFishAudioConfig,
  patch: FishAudioConfigPatch,
): StoredFishAudioConfig {
  return {
    ...current,
    ...patch,
    apiKey: patch.apiKey === undefined ? current.apiKey : (patch.apiKey ?? ""),
  };
}

function patchFishAudioStt(
  current: StoredFishAudioSttConfig,
  patch: FishAudioSttConfigPatch,
): StoredFishAudioSttConfig {
  return {
    ...current,
    ...patch,
    apiKey: patch.apiKey === undefined ? current.apiKey : (patch.apiKey ?? ""),
    language:
      patch.language === undefined
        ? current.language
        : (patch.language ?? "").trim(),
  };
}

function patchFigureConfig(
  type: AgentType,
  current: StoredFigureRuntimeConfig,
  patch: ConversationRuntimeConfigPatchRequest["config"],
) {
  if (type === "slice-figure")
    return patchSliceConfig(
      current as StoredSliceFigureRuntimeConfig,
      patch as SliceFigureRuntimeConfigPatch,
    );
  if (type === "prime-figure")
    return patchPrimeConfig(
      current as StoredPrimeFigureRuntimeConfig,
      patch as PrimeFigureRuntimeConfigPatch,
    );
  return current;
}

function selectFigureConfig(config: StoredUserRuntimeConfig, type: AgentType) {
  if (type === "slice-figure") return config.sliceFigure;
  if (type === "prime-figure") return config.primeFigure;
  return config.primeWorld;
}

function redactUserConfig(
  config: StoredUserRuntimeConfig,
): UserRuntimeConfigView {
  return {
    ...config,
    sliceFigure: redactFigureConfig(config.sliceFigure),
    primeFigure: redactFigureConfig(config.primeFigure),
    primeWorld: config.primeWorld,
  } as UserRuntimeConfigView;
}

function redactPresets(presets: StoredRuntimeConfigPresets) {
  return {
    sliceFigure: presets.sliceFigure.map((preset) => ({
      ...preset,
      config: redactFigureConfig(preset.config),
    })),
    primeFigure: presets.primeFigure.map((preset) => ({
      ...preset,
      config: redactFigureConfig(preset.config),
    })),
  };
}

function selectRedactedPresets(
  presets: StoredRuntimeConfigPresets,
  type: AgentType,
) {
  const redacted = redactPresets(presets);
  if (type === "slice-figure") return redacted.sliceFigure;
  if (type === "prime-figure") return redacted.primeFigure;
  return [];
}

function redactFigureConfig(config: StoredFigureRuntimeConfig): any {
  if (!("llm" in config) && !("decisionModel" in config)) return config;
  if ("llm" in config) return { ...config, llm: redactEndpoint(config.llm) };
  return {
    ...config,
    decisionModel: redactEndpoint(config.decisionModel),
    outputs: {
      image: {
        ...config.outputs.image,
        generator: redactEndpoint(config.outputs.image.generator),
      },
      voice: {
        ...config.outputs.voice,
        tts: redactFishAudio(config.outputs.voice.tts),
      },
      sticker: config.outputs.sticker,
      transfer: config.outputs.transfer,
    },
    optimization: {
      image: {
        ...config.optimization.image,
        model: redactEndpoint(config.optimization.image.model),
      },
      voice: {
        ...config.optimization.voice,
        model: redactEndpoint(config.optimization.voice.model),
      },
    },
    understanding: {
      visual: {
        ...config.understanding.visual,
        model: redactEndpoint(config.understanding.visual.model),
      },
      audio: {
        ...config.understanding.audio,
        model: redactEndpoint(config.understanding.audio.model),
        stt: redactFishAudioStt(config.understanding.audio.stt),
      },
    },
  };
}

function redactEndpoint(config: StoredModelEndpointConfig) {
  const { apiKey, ...rest } = config;
  const visible =
    config.source === "platform"
      ? (({ baseUrl: _baseUrl, ...value }) => value)(rest)
      : rest;
  return {
    ...visible,
    apiKey:
      config.source === "platform"
        ? { configured: false }
        : redactSecret(apiKey),
  };
}

function redactFishAudio(config: StoredFishAudioConfig) {
  const { apiKey, ...rest } = config;
  const visible =
    config.source === "platform"
      ? (({ httpUrl: _httpUrl, wsUrl: _wsUrl, ...value }) => value)(rest)
      : rest;
  return {
    ...visible,
    apiKey:
      config.source === "platform"
        ? { configured: false }
        : redactSecret(apiKey),
  };
}

function redactFishAudioStt(config: StoredFishAudioSttConfig) {
  const { apiKey, ...rest } = config;
  const visible =
    config.source === "platform"
      ? (({ httpUrl: _httpUrl, ...value }) => value)(rest)
      : rest;
  return {
    ...visible,
    ...(visible.language ? {} : { language: undefined }),
    apiKey:
      config.source === "platform"
        ? { configured: false }
        : redactSecret(apiKey),
  };
}

function redactSecret(secret: string) {
  if (!secret) return { configured: false };
  const suffix = secret.slice(-4);
  return { configured: true, masked: `••••${suffix}` };
}

function validateUserConfig(config: StoredUserRuntimeConfig) {
  validateFigureConfig("slice-figure", config.sliceFigure);
  validateFigureConfig("prime-figure", config.primeFigure);
}

function validateFigureConfig(
  type: AgentType,
  config: StoredFigureRuntimeConfig,
) {
  if (type === "slice-figure") {
    const value = config as StoredSliceFigureRuntimeConfig;
    validateTextModel(value.llm);
    positiveInteger(value.context.minimumRounds, "最小上下文轮数");
    positiveInteger(value.context.maximumRounds, "最大上下文轮数");
    positiveInteger(value.context.memorySummaryRounds, "记忆总结轮数");
    if (value.context.maximumRounds < value.context.minimumRounds)
      invalid("最大上下文轮数不能小于最小上下文轮数。");
    return;
  }
  if (type === "prime-figure") {
    const value = config as StoredPrimeFigureRuntimeConfig;
    validateTextModel(value.decisionModel);
    if (value.outputs.image.enabled)
      validateEndpoint(value.outputs.image.generator);
    if (value.outputs.image.enabled)
      validateImageParameters(
        value.outputs.image.generator,
        value.outputs.image.parameters,
      );
    if (value.outputs.voice.enabled) {
      const tts = value.outputs.voice.tts;
      if (
        !tts.model.trim() ||
        (tts.source === "custom" &&
          (!tts.httpUrl.trim() || !tts.wsUrl.trim() || !tts.apiKey.trim()))
      )
        invalid(
          "语音输出开启时模型不能为空；自定义 TTS 还必须配置地址和 API Key。",
        );
      positiveInteger(tts.chunkLength, "Fish Audio 分块长度");
    }
    if (value.optimization.image.enabled)
      validateTextModel(value.optimization.image.model);
    if (value.optimization.voice.enabled)
      validateTextModel(value.optimization.voice.model);
    if (value.optimization.image.enabled && !value.outputs.image.enabled)
      invalid("开启额外生图优化前必须允许 figure 发送图片。");
    if (value.optimization.voice.enabled && !value.outputs.voice.enabled)
      invalid("开启额外语音优化前必须允许 figure 发送语音。");
    if (value.understanding.visual.mode === "auxiliary")
      validateTextModel(value.understanding.visual.model);
    if (value.understanding.audio.mode === "auxiliary")
      validateTextModel(value.understanding.audio.model);
    if (value.understanding.audio.mode === "stt") {
      const stt = value.understanding.audio.stt;
      if (
        stt.source === "custom" &&
        (!stt.httpUrl.trim() || !stt.apiKey.trim())
      )
        invalid("自定义 STT 必须配置地址和 API Key。");
    }
    positiveInteger(value.context.minimumMessages, "最小上下文消息数");
    positiveInteger(value.context.maximumMessages, "最大上下文消息数");
    positiveNumber(value.typingCharsPerMinute, "每分钟打字字符数");
    nonnegativeNumber(value.messageCoalesceMs, "消息合并间隔");
    nonnegativeInteger(
      value.wakeups.proactive.interactionInvalidationWindowMinutes,
      "主动唤醒互动失效窗口",
    );
    const [first, second, third] = value.wakeups.passive.milestonesMinutes;
    positiveInteger(first, "第一次被动唤醒时间");
    positiveInteger(second, "第二次被动唤醒时间");
    positiveInteger(third, "第三次被动唤醒时间");
    if (!(first < second && second < third))
      invalid("被动唤醒时间必须严格递增。");
    if (value.context.maximumMessages < value.context.minimumMessages)
      invalid("最大上下文消息数不能小于最小上下文消息数。");
  }
}

function validateTextModel(config: StoredTextModelConfig) {
  validateEndpoint(config);
  finiteNumber(config.temperature, "温度");
  positiveNumber(config.maxTokens, "最大输出 token 数");
}

function validateEndpoint(config: StoredModelEndpointConfig) {
  if (!config.model.trim()) invalid("模型不能为空。");
  if (
    config.source === "custom" &&
    (!config.baseUrl.trim() || !config.apiKey.trim())
  )
    invalid("自定义模型必须配置 API 地址和 API Key。");
}

function normalizeImageParameters(
  endpoint: StoredModelEndpointConfig,
  parameters: Record<string, unknown> | undefined,
) {
  const value =
    parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? structuredClone(parameters)
      : {};
  if (endpoint.source !== "platform") return value;
  if (endpoint.model === "openai/gpt-image-2")
    return { quality: "low", ...value };
  if (endpoint.model === "google/gemini-3.1-flash-lite-image")
    return { resolution: "1K", ...value };
  return value;
}

function validateImageParameters(
  endpoint: StoredModelEndpointConfig,
  parameters: Record<string, unknown>,
) {
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  )
    invalid("生图参数必须是 JSON 对象。");
  let serialized = "";
  try {
    serialized = JSON.stringify(parameters);
  } catch {
    invalid("生图参数必须可以序列化为 JSON。");
  }
  if (serialized.length > 16_384) invalid("生图参数不能超过 16KB。");
  if (endpoint.source !== "platform") return;
  if (endpoint.model === "openai/gpt-image-2") {
    if (Object.keys(parameters).some((key) => key !== "quality"))
      invalid("GPT Image 2 平台配置仅支持 quality 参数。");
    const quality = parameters.quality;
    if (!["auto", "low", "medium", "high"].includes(String(quality)))
      invalid("GPT Image 2 的质量必须是 auto、low、medium 或 high。");
    return;
  }
  if (endpoint.model === "google/gemini-3.1-flash-lite-image") {
    if (Object.keys(parameters).some((key) => key !== "resolution"))
      invalid("Gemini 3.1 Flash Lite Image 平台配置仅支持 resolution 参数。");
    if (parameters.resolution !== "1K")
      invalid("Gemini 3.1 Flash Lite Image 当前仅支持 1K 分辨率。");
  }
}

function resolvePlatformFigureConfig(
  config: StoredFigureRuntimeConfig,
): StoredFigureRuntimeConfig {
  const resolveText = (value: StoredTextModelConfig) =>
    resolvePlatformTextEndpoint(value);
  if ("llm" in config) return { ...config, llm: resolveText(config.llm) };
  if (!("decisionModel" in config)) return config;
  const tts = config.outputs.voice.tts;
  return {
    ...config,
    decisionModel: resolveText(config.decisionModel),
    outputs: {
      ...config.outputs,
      image: {
        ...config.outputs.image,
        generator: resolvePlatformOpenRouterEndpoint(
          config.outputs.image.generator,
        ),
      },
      voice: {
        ...config.outputs.voice,
        tts:
          tts.source === "platform"
            ? {
                ...tts,
                httpUrl: environment.platformFishAudioHttpUrl,
                wsUrl: environment.platformFishAudioWsUrl,
                apiKey: environment.platformFishAudioApiKey,
              }
            : tts,
      },
    },
    optimization: {
      image: {
        ...config.optimization.image,
        model: resolveText(config.optimization.image.model),
      },
      voice: {
        ...config.optimization.voice,
        model: resolveText(config.optimization.voice.model),
      },
    },
    understanding: {
      visual: {
        ...config.understanding.visual,
        model: resolveText(config.understanding.visual.model),
      },
      audio: {
        ...config.understanding.audio,
        model: resolveText(config.understanding.audio.model),
        stt:
          config.understanding.audio.stt.source === "platform"
            ? {
                ...config.understanding.audio.stt,
                httpUrl: environment.platformFishAudioAsrUrl,
                apiKey: environment.platformFishAudioApiKey,
              }
            : config.understanding.audio.stt,
      },
    },
  };
}

export function resolvePlatformTextEndpoint<
  T extends StoredModelEndpointConfig,
>(value: T): T {
  if (value.source !== "platform") return value;
  if (isPlatformDeepSeekRoute(value))
    return {
      ...value,
      baseUrl: PLATFORM_DEEPSEEK_BASE_URL,
      apiKey: environment.platformDeepSeekApiKey,
    };
  return resolvePlatformOpenRouterEndpoint(value);
}

export function resolvePlatformOpenRouterEndpoint<
  T extends StoredModelEndpointConfig,
>(value: T): T {
  return value.source === "platform"
    ? {
        ...value,
        baseUrl: environment.platformOpenRouterBaseUrl,
        apiKey: environment.platformOpenRouterApiKey,
      }
    : value;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) invalid(`${label}必须是正整数。`);
}

function positiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) invalid(`${label}必须大于 0。`);
}

function nonnegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) invalid(`${label}不能小于 0。`);
}

function nonnegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) invalid(`${label}不能小于 0。`);
}

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) invalid(`${label}必须是有效数字。`);
}

function invalid(message: string): never {
  throw new RuntimeConfigValidationError(message);
}

function isRecoverableStoredConfigError(error: unknown) {
  return (
    error instanceof RuntimeConfigValidationError ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  );
}

function isAgentType(value: string): value is AgentType {
  return (
    value === "slice-figure" ||
    value === "prime-figure" ||
    value === "prime-world"
  );
}
