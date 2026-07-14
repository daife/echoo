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

export interface PrimeFigureRuntimeConfigView {
  version: 1;
  llm: TextModelConfigView;
  image: ModelEndpointConfigView;
  tts: FishAudioConfigView;
  context: {
    minimumMessages: number;
    maximumMessages: number;
  };
  typingCharsPerMinute: number;
  messageCoalesceMs: number;
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
  llm?: TextModelConfigPatch;
  image?: ModelEndpointConfigPatch;
  tts?: FishAudioConfigPatch;
  context?: Partial<PrimeFigureRuntimeConfigView["context"]>;
  typingCharsPerMinute?: number;
  messageCoalesceMs?: number;
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
