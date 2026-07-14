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
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import { RuntimeConfigRepository } from "./runtime-config.repository.js";
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
  ) {}

  async getUserConfig(ownerUserId: string): Promise<UserRuntimeConfigView> {
    return redactUserConfig(await this.ensureUserConfig(ownerUserId));
  }

  async initializeNewUserConfig(ownerUserId: string) {
    await this.repository.insertUserConfigIfAbsent(
      ownerUserId,
      buildRuntimeConfigDefaults({ includeEnvironmentSecrets: false }),
    );
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
    await this.repository.saveUserConfig(ownerUserId, next);
    return redactUserConfig(next);
  }

  async getConversationConfig(
    ownerUserId: string,
    conversationId: string,
  ): Promise<ConversationRuntimeConfigResponse> {
    const resolved = await this.resolveConversationConfig(
      ownerUserId,
      conversationId,
    );
    return {
      mode: resolved.mode,
      conversationType: resolved.conversationType,
      config: redactFigureConfig(resolved.config),
    };
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
    let custom = stored?.customConfig ?? null;
    if (input.mode === "custom") {
      custom ??= structuredClone(global);
      if (input.config)
        custom = patchFigureConfig(conversation.type, custom, input.config);
      validateFigureConfig(conversation.type, custom);
    }
    await this.repository.saveConversationConfig({
      ownerUserId,
      conversationId,
      mode: input.mode,
      customConfig: custom,
    });
    return {
      mode: input.mode,
      conversationType: conversation.type,
      config: redactFigureConfig(input.mode === "custom" ? custom! : global),
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
    const custom = stored?.customConfig;
    const mode = stored?.mode === "custom" && custom ? "custom" : "global";
    const config = mode === "custom" ? custom! : global;
    validateFigureConfig(conversation.type, config);
    return { mode, conversationType: conversation.type, config };
  }

  private async ensureUserConfig(ownerUserId: string) {
    const existing = await this.repository.findUserConfig(ownerUserId);
    if (existing) return existing;
    await this.repository.insertUserConfigIfAbsent(
      ownerUserId,
      buildRuntimeConfigDefaults(),
    );
    const created = await this.repository.findUserConfig(ownerUserId);
    if (!created)
      throw new RuntimeConfigNotFoundError("无法初始化用户运行配置。");
    return created;
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
}

function patchSliceConfig(
  current: StoredSliceFigureRuntimeConfig,
  patch: SliceFigureRuntimeConfigPatch,
): StoredSliceFigureRuntimeConfig {
  return {
    ...current,
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
    llm: patch.llm ? patchTextModel(current.llm, patch.llm) : current.llm,
    image: patch.image
      ? patchEndpoint(current.image, patch.image)
      : current.image,
    tts: patch.tts ? patchFishAudio(current.tts, patch.tts) : current.tts,
    context: { ...current.context, ...patch.context },
    typingCharsPerMinute:
      patch.typingCharsPerMinute ?? current.typingCharsPerMinute,
    messageCoalesceMs: patch.messageCoalesceMs ?? current.messageCoalesceMs,
  };
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
    ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey ?? "" } : {}),
  } as T;
  if (patch.routingProvider === null) delete next.routingProvider;
  else if (patch.routingProvider !== undefined)
    next.routingProvider = patch.routingProvider;
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
  if (!("llm" in config)) return config;
  if (!("image" in config))
    return { ...config, llm: redactEndpoint(config.llm) };
  return {
    ...config,
    llm: redactEndpoint(config.llm),
    image: redactEndpoint(config.image),
    tts: {
      ...config.tts,
      apiKey: redactSecret(config.tts.apiKey),
    },
  };
}

function redactEndpoint(config: StoredModelEndpointConfig) {
  const { apiKey, ...rest } = config;
  return { ...rest, apiKey: redactSecret(apiKey) };
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
    validateTextModel(value.llm);
    validateEndpoint(value.image);
    positiveInteger(value.tts.chunkLength, "Fish Audio 分块长度");
    positiveInteger(value.context.minimumMessages, "最小上下文消息数");
    positiveInteger(value.context.maximumMessages, "最大上下文消息数");
    positiveNumber(value.typingCharsPerMinute, "每分钟打字字符数");
    nonnegativeNumber(value.messageCoalesceMs, "消息合并间隔");
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
  if (!config.provider.trim() || !config.baseUrl.trim() || !config.model.trim())
    invalid("模型提供商、地址和模型不能为空。");
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

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) invalid(`${label}必须是有效数字。`);
}

function invalid(message: string): never {
  throw new RuntimeConfigValidationError(message);
}

function isAgentType(value: string): value is AgentType {
  return (
    value === "slice-figure" ||
    value === "prime-figure" ||
    value === "prime-world"
  );
}
