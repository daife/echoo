import type { AgentType } from "./agent.js";

export type RuntimeConfigMode = "global" | "custom";

export interface RuntimeSecretView {
  configured: boolean;
  masked?: string;
}

export interface ModelEndpointConfigView {
  provider: string;
  routingProvider?: string;
  baseUrl: string;
  model: string;
  apiKey: RuntimeSecretView;
}

export interface TextModelConfigView extends ModelEndpointConfigView {
  temperature: number;
  maxTokens: number;
}

export interface FishAudioConfigView {
  provider: string;
  apiKey: RuntimeSecretView;
  referenceId: string;
  model: string;
  httpUrl: string;
  wsUrl: string;
  latency: string;
  chunkLength: number;
}

export interface SliceFigureRuntimeConfigView {
  version: 1;
  llm: TextModelConfigView;
  context: {
    minimumRounds: number;
    maximumRounds: number;
    memorySummaryRounds: number;
  };
}

export type PrimeFigureGuidanceLevel = "basic" | "medium" | "advanced";
export type PrimeFigureOptimizationLevel = "advanced" | "top";
export type PrimeFigureUnderstandingMode = "native" | "auxiliary";

export interface PrimeFigureOutputConfigView {
  image: {
    enabled: boolean;
    guidanceLevel: PrimeFigureGuidanceLevel;
    generator: ModelEndpointConfigView;
  };
  voice: {
    enabled: boolean;
    guidanceLevel: PrimeFigureGuidanceLevel;
    tts: FishAudioConfigView;
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
    mode: PrimeFigureUnderstandingMode;
    model: TextModelConfigView;
  };
  audio: {
    mode: PrimeFigureUnderstandingMode;
    model: TextModelConfigView;
  };
}

export interface PrimeFigureRuntimeConfigView {
  version: 3;
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
  version: 1;
  sliceFigure: SliceFigureRuntimeConfigView;
  primeFigure: PrimeFigureRuntimeConfigView;
  primeWorld: PrimeWorldRuntimeConfigView;
}

export interface ModelEndpointConfigPatch {
  provider?: string;
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
  provider?: string;
  apiKey?: string | null;
  referenceId?: string;
  model?: string;
  httpUrl?: string;
  wsUrl?: string;
  latency?: string;
  chunkLength?: number;
}

export interface SliceFigureRuntimeConfigPatch {
  llm?: TextModelConfigPatch;
  context?: Partial<SliceFigureRuntimeConfigView["context"]>;
}

export interface PrimeFigureRuntimeConfigPatch {
  decisionModel?: TextModelConfigPatch;
  outputs?: {
    image?: {
      enabled?: boolean;
      guidanceLevel?: PrimeFigureGuidanceLevel;
      generator?: ModelEndpointConfigPatch;
    };
    voice?: {
      enabled?: boolean;
      guidanceLevel?: PrimeFigureGuidanceLevel;
      tts?: FishAudioConfigPatch;
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
      mode?: PrimeFigureUnderstandingMode;
      model?: TextModelConfigPatch;
    };
    audio?: {
      mode?: PrimeFigureUnderstandingMode;
      model?: TextModelConfigPatch;
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
  config: FigureRuntimeConfigView;
}

export interface ConversationRuntimeConfigPatchRequest {
  mode: RuntimeConfigMode;
  config?: FigureRuntimeConfigPatch;
}
