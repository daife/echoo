import type {
  AgentType,
  ConversationRuntimeConfigPatchRequest,
  ConversationRuntimeConfigResponse,
  FishAudioConfigPatch,
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
  StoredModelEndpointConfig,
  StoredPrimeFigureRuntimeConfig,
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
    return redactUserConfig(await this.ensureUserConfig(ownerUserId));
  }

  async initializeUserConfig(ownerUserId: string) {
    const defaults = await this.readNewUserDefaults();
    await this.repository.insertUserConfigIfAbsent(ownerUserId, defaults);
  }

  async getAdminRuntimeDefaults() {
    const stored = await this.platformSettings.getNewUserRuntimeDefaults();
    const config = this.normalizePlatformDefaults(stored.config);
    return {
      config: redactUserConfig(config),
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
      updatedAt: saved.updatedAt,
    };
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
      custom = storedCustom
        ? normalizeFigureConfig(conversation.type, storedCustom)
        : structuredClone(global);
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
    const userConfig = normalizeUserConfig(stored.userConfig);
    if (JSON.stringify(userConfig) !== JSON.stringify(stored.userConfig))
      await this.repository.saveUserConfig(ownerUserId, userConfig);
    const conversationType = stored.conversationType as AgentType;
    const global = selectFigureConfig(userConfig, conversationType);
    const custom = stored.customConfig
      ? normalizeFigureConfig(conversationType, stored.customConfig)
      : null;
    const mode = stored?.mode === "custom" && custom ? "custom" : "global";
    const config = mode === "custom" ? custom! : global;
    validateFigureConfig(conversationType, config);
    return { mode, conversationType, config };
  }

  private async ensureUserConfig(ownerUserId: string) {
    const existing = await this.repository.findUserConfig(ownerUserId);
    if (existing) {
      const normalized = normalizeUserConfig(existing);
      if (JSON.stringify(normalized) !== JSON.stringify(existing))
        await this.repository.saveUserConfig(ownerUserId, normalized);
      return normalized;
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

  private normalizePlatformDefaults(config: StoredUserRuntimeConfig) {
    try {
      const normalized = forcePlatformDefaults(normalizeUserConfig(config));
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

function normalizeUserConfig(
  config: StoredUserRuntimeConfig,
): StoredUserRuntimeConfig {
  return {
    ...config,
    version: 2,
    sliceFigure: {
      ...config.sliceFigure,
      version: 2,
      llm: normalizeEndpoint(config.sliceFigure.llm),
    },
    primeFigure: normalizePrimeConfig(config.primeFigure),
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
        },
      },
    },
  };
}

function normalizeFigureConfig(
  type: AgentType,
  config: StoredFigureRuntimeConfig,
): StoredFigureRuntimeConfig {
  return type === "prime-figure"
    ? normalizePrimeConfig(config as StoredPrimeFigureRuntimeConfig)
    : config;
}

function normalizePrimeConfig(
  config: StoredPrimeFigureRuntimeConfig,
): StoredPrimeFigureRuntimeConfig {
  const defaults = buildRuntimeConfigDefaults().primeFigure;
  const legacy = config as StoredPrimeFigureRuntimeConfig & {
    wakeups?: StoredPrimeFigureRuntimeConfig["wakeups"];
    outputs: StoredPrimeFigureRuntimeConfig["outputs"] & {
      sticker?: StoredPrimeFigureRuntimeConfig["outputs"]["sticker"];
      transfer?: StoredPrimeFigureRuntimeConfig["outputs"]["transfer"];
    };
  };
  return {
    ...config,
    version: 5,
    decisionModel: normalizeTextEndpoint(config.decisionModel),
    outputs: {
      ...config.outputs,
      image: {
        ...config.outputs.image,
        generator: normalizeEndpoint(config.outputs.image.generator),
      },
      voice: {
        ...config.outputs.voice,
        tts: normalizeFishAudio(config.outputs.voice.tts),
      },
      sticker: {
        ...defaults.outputs.sticker,
        ...legacy.outputs?.sticker,
      },
      transfer: {
        ...defaults.outputs.transfer,
        ...legacy.outputs?.transfer,
      },
    },
    optimization: {
      image: {
        ...config.optimization.image,
        model: normalizeTextEndpoint(config.optimization.image.model),
      },
      voice: {
        ...config.optimization.voice,
        model: normalizeTextEndpoint(config.optimization.voice.model),
      },
    },
    understanding: {
      visual: {
        ...config.understanding.visual,
        model: normalizeTextEndpoint(config.understanding.visual.model),
      },
      audio: {
        ...config.understanding.audio,
        model: normalizeTextEndpoint(config.understanding.audio.model),
      },
    },
    wakeups: {
      proactive: {
        ...defaults.wakeups.proactive,
        ...legacy.wakeups?.proactive,
      },
      passive: {
        ...defaults.wakeups.passive,
        ...legacy.wakeups?.passive,
      },
    },
  };
}

function patchSliceConfig(
  current: StoredSliceFigureRuntimeConfig,
  patch: SliceFigureRuntimeConfigPatch,
): StoredSliceFigureRuntimeConfig {
  return {
    ...current,
    version: 2,
    llm: patch.llm ? patchTextModel(current.llm, patch.llm) : current.llm,
    context: { ...current.context, ...patch.context },
  };
}

function patchPrimeConfig(
  current: StoredPrimeFigureRuntimeConfig,
  patch: PrimeFigureRuntimeConfigPatch,
): StoredPrimeFigureRuntimeConfig {
  return {
    ...current,
    version: 5,
    decisionModel: patch.decisionModel
      ? patchTextModel(current.decisionModel, patch.decisionModel)
      : current.decisionModel,
    outputs: {
      image: {
        ...current.outputs.image,
        ...patch.outputs?.image,
        generator: patch.outputs?.image?.generator
          ? patchEndpoint(
              current.outputs.image.generator,
              patch.outputs.image.generator,
            )
          : current.outputs.image.generator,
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
      audio: patchPrimeModelFeature(
        current.understanding.audio,
        patch.understanding?.audio,
      ),
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

function normalizeEndpoint<T extends StoredModelEndpointConfig>(config: T): T {
  const legacy = config as T & {
    provider?: string;
    source?: "platform" | "custom";
  };
  const { provider: _provider, ...rest } = legacy;
  return {
    ...rest,
    source: legacy.source ?? (legacy.apiKey?.trim() ? "custom" : "platform"),
  } as T;
}

function normalizeTextEndpoint(config: StoredTextModelConfig) {
  return normalizeEndpoint(config);
}

function normalizeFishAudio(config: StoredFishAudioConfig) {
  const legacy = config as StoredFishAudioConfig & {
    provider?: string;
    source?: "platform" | "custom";
  };
  const { provider: _provider, ...rest } = legacy;
  return {
    ...rest,
    source: legacy.source ?? (legacy.apiKey?.trim() ? "custom" : "platform"),
  };
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
