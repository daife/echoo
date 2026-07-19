import type { AgentType } from "./agent.js";

export type RuntimeConfigMode = "global" | "custom";
export type CredentialSource = "platform" | "custom";

export interface RuntimeSecretView {
  configured: boolean;
  masked?: string;
}

export interface ModelEndpointConfigView {
  source: CredentialSource;
  routingProvider?: string;
  baseUrl?: string;
  model: string;
  apiKey: RuntimeSecretView;
}

export interface TextModelConfigView extends ModelEndpointConfigView {
  temperature: number;
  maxTokens: number;
}

export interface FishAudioConfigView {
  source: CredentialSource;
  apiKey: RuntimeSecretView;
  referenceId: string;
  model: string;
  httpUrl?: string;
  wsUrl?: string;
  latency: string;
  chunkLength: number;
}

export interface FishAudioSttConfigView {
  source: CredentialSource;
  apiKey: RuntimeSecretView;
  httpUrl?: string;
  /** Empty or omitted lets Fish Audio detect the spoken language. */
  language?: string;
}

export interface SliceFigureRuntimeConfigView {
  version: 3;
  llm: TextModelConfigView;
  replyAutoSegment: boolean;
  context: {
    minimumRounds: number;
    maximumRounds: number;
    memorySummaryRounds: number;
  };
}

export type PrimeFigureGuidanceLevel = "basic" | "medium" | "advanced";
export type PrimeFigureOptimizationLevel = "advanced" | "top";
export type PrimeFigureVisualUnderstandingMode = "native" | "auxiliary";
export type PrimeFigureAudioUnderstandingMode =
  PrimeFigureVisualUnderstandingMode | "stt";

export interface PrimeFigureOutputConfigView {
  image: {
    enabled: boolean;
    guidanceLevel: PrimeFigureGuidanceLevel;
    generator: ModelEndpointConfigView;
    /** Model-specific parameters passed to the image generation endpoint. */
    parameters: Record<string, unknown>;
  };
  voice: {
    enabled: boolean;
    requestStreaming: boolean;
    autoPlay: boolean;
    guidanceLevel: PrimeFigureGuidanceLevel;
    tts: FishAudioConfigView;
  };
  sticker: {
    enabled: boolean;
  };
  transfer: {
    enabled: boolean;
  };
}

export interface PrimeFigureOptimizationConfigView {
  image: {
    enabled: boolean;
    level: PrimeFigureOptimizationLevel;
    model: TextModelConfigView;
  };
  voice: {
    enabled: boolean;
    level: PrimeFigureOptimizationLevel;
    model: TextModelConfigView;
  };
}

export interface PrimeFigureUnderstandingConfigView {
  visual: {
    mode: PrimeFigureVisualUnderstandingMode;
    model: TextModelConfigView;
  };
  audio: {
    mode: PrimeFigureAudioUnderstandingMode;
    model: TextModelConfigView;
    stt: FishAudioSttConfigView;
  };
}

export interface PrimeFigureRuntimeConfigView {
  version: 9;
  decisionModel: TextModelConfigView;
  outputs: PrimeFigureOutputConfigView;
  optimization: PrimeFigureOptimizationConfigView;
  understanding: PrimeFigureUnderstandingConfigView;
  context: {
    minimumMessages: number;
    maximumMessages: number;
  };
  typingCharsPerMinute: number;
  messageCoalesceMs: number;
  wakeups: PrimeFigureWakeupConfig;
}

export interface PrimeFigureWakeupConfig {
  proactive: {
    enabled: boolean;
    interactionInvalidationWindowMinutes: number;
  };
  passive: {
    enabled: boolean;
    milestonesMinutes: [number, number, number];
  };
}

export interface PrimeWorldRuntimeConfigView {
  version: 1;
}

export interface UserRuntimeConfigView {
  version: 2;
  sliceFigure: SliceFigureRuntimeConfigView;
  primeFigure: PrimeFigureRuntimeConfigView;
  primeWorld: PrimeWorldRuntimeConfigView;
  presets?: RuntimeConfigPresetsView;
  warnings?: RuntimeConfigWarning[];
}

export interface AdminRuntimeDefaultsView {
  config: UserRuntimeConfigView;
  presets: RuntimeConfigPresetsView;
  updatedAt: number;
}

export interface RuntimeConfigPresetView<TConfig> {
  id: string;
  name: string;
  config: TConfig;
}

export interface RuntimeConfigPresetsView {
  sliceFigure: Array<RuntimeConfigPresetView<SliceFigureRuntimeConfigView>>;
  primeFigure: Array<RuntimeConfigPresetView<PrimeFigureRuntimeConfigView>>;
}

export interface ModelEndpointConfigPatch {
  source?: CredentialSource;
  routingProvider?: string | null;
  baseUrl?: string;
  model?: string;
  /** Omitted keeps the stored key; null clears it. */
  apiKey?: string | null;
}

export interface TextModelConfigPatch extends ModelEndpointConfigPatch {
  temperature?: number;
  maxTokens?: number;
}

export interface FishAudioConfigPatch {
  source?: CredentialSource;
  apiKey?: string | null;
  referenceId?: string;
  model?: string;
  httpUrl?: string;
  wsUrl?: string;
  latency?: string;
  chunkLength?: number;
}

export interface FishAudioSttConfigPatch {
  source?: CredentialSource;
  apiKey?: string | null;
  httpUrl?: string;
  /** Null or an empty string restores automatic language detection. */
  language?: string | null;
}

export interface SliceFigureRuntimeConfigPatch {
  llm?: TextModelConfigPatch;
  replyAutoSegment?: boolean;
  context?: Partial<SliceFigureRuntimeConfigView["context"]>;
}

export interface PrimeFigureRuntimeConfigPatch {
  decisionModel?: TextModelConfigPatch;
  outputs?: {
    image?: {
      enabled?: boolean;
      guidanceLevel?: PrimeFigureGuidanceLevel;
      generator?: ModelEndpointConfigPatch;
      parameters?: Record<string, unknown>;
    };
    voice?: {
      enabled?: boolean;
      requestStreaming?: boolean;
      autoPlay?: boolean;
      guidanceLevel?: PrimeFigureGuidanceLevel;
      tts?: FishAudioConfigPatch;
    };
    sticker?: {
      enabled?: boolean;
    };
    transfer?: {
      enabled?: boolean;
    };
  };
  optimization?: {
    image?: {
      enabled?: boolean;
      level?: PrimeFigureOptimizationLevel;
      model?: TextModelConfigPatch;
    };
    voice?: {
      enabled?: boolean;
      level?: PrimeFigureOptimizationLevel;
      model?: TextModelConfigPatch;
    };
  };
  understanding?: {
    visual?: {
      mode?: PrimeFigureVisualUnderstandingMode;
      model?: TextModelConfigPatch;
    };
    audio?: {
      mode?: PrimeFigureAudioUnderstandingMode;
      model?: TextModelConfigPatch;
      stt?: FishAudioSttConfigPatch;
    };
  };
  context?: Partial<PrimeFigureRuntimeConfigView["context"]>;
  typingCharsPerMinute?: number;
  messageCoalesceMs?: number;
  wakeups?: {
    proactive?: {
      enabled?: boolean;
      interactionInvalidationWindowMinutes?: number;
    };
    passive?: {
      enabled?: boolean;
      milestonesMinutes?: [number, number, number];
    };
  };
}

export interface UserRuntimeConfigPatch {
  sliceFigure?: SliceFigureRuntimeConfigPatch;
  primeFigure?: PrimeFigureRuntimeConfigPatch;
  primeWorld?: Record<string, never>;
}

export type FigureRuntimeConfigView =
  | SliceFigureRuntimeConfigView
  | PrimeFigureRuntimeConfigView
  | PrimeWorldRuntimeConfigView;

export type FigureRuntimeConfigPatch =
  | SliceFigureRuntimeConfigPatch
  | PrimeFigureRuntimeConfigPatch
  | Record<string, never>;

export interface ConversationRuntimeConfigResponse {
  mode: RuntimeConfigMode;
  conversationType: AgentType;
  config?: FigureRuntimeConfigView;
  presets?: Array<
    | RuntimeConfigPresetView<SliceFigureRuntimeConfigView>
    | RuntimeConfigPresetView<PrimeFigureRuntimeConfigView>
  >;
  validationError?: string;
  warnings?: RuntimeConfigWarning[];
}

export interface RuntimeConfigWarning {
  path: string;
  code: "MODEL_NOT_IN_CATALOG" | "MODEL_METADATA_STALE" | "PROVIDER_UNVERIFIED";
  message: string;
}

export type ModelRecommendationCategory =
  | "slice_text"
  | "prime_decision"
  | "image_generation"
  | "image_optimization"
  | "voice_optimization"
  | "visual_understanding"
  | "audio_understanding"
  | "fish_tts";

export interface RecommendedModelView {
  category: ModelRecommendationCategory;
  modelId: string;
  name: string;
  inputModalities: string[];
  outputModalities: string[];
  pricing: Record<string, string | number | null>;
  recommendedProviders: Array<{ slug: string; name: string }>;
}

export interface WalletView {
  balanceUsd: string;
  entries: Array<{
    id: string;
    kind:
      | "admin_credit"
      | "admin_debit"
      | "initial_credit"
      | "usage"
      | "invite_referrer_reward"
      | "invite_redeemer_reward"
      | "promotion_reward"
      | "creator_reward"
      | "recharge";
    amountUsd: string;
    balanceAfterUsd: string;
    service?: string;
    model?: string;
    note?: string;
    createdAt: number;
  }>;
}

export interface ConversationRuntimeConfigPatchRequest {
  mode: RuntimeConfigMode;
  config?: FigureRuntimeConfigPatch;
}
