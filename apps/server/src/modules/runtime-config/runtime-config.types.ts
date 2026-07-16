export interface StoredModelEndpointConfig {
  source: "platform" | "custom";
  routingProvider?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StoredTextModelConfig extends StoredModelEndpointConfig {
  temperature: number;
  maxTokens: number;
}

export interface StoredFishAudioConfig {
  source: "platform" | "custom";
  apiKey: string;
  referenceId: string;
  model: string;
  httpUrl: string;
  wsUrl: string;
  latency: string;
  chunkLength: number;
}

export interface StoredSliceFigureRuntimeConfig {
  version: 2;
  llm: StoredTextModelConfig;
  context: {
    minimumRounds: number;
    maximumRounds: number;
    memorySummaryRounds: number;
  };
}

export interface StoredPrimeFigureRuntimeConfig {
  version: 6;
  decisionModel: StoredTextModelConfig;
  outputs: {
    image: {
      enabled: boolean;
      guidanceLevel: "basic" | "medium" | "advanced";
      generator: StoredModelEndpointConfig;
      parameters: Record<string, unknown>;
    };
    voice: {
      enabled: boolean;
      guidanceLevel: "basic" | "medium" | "advanced";
      tts: StoredFishAudioConfig;
    };
    sticker: {
      enabled: boolean;
    };
    transfer: {
      enabled: boolean;
    };
  };
  optimization: {
    image: {
      enabled: boolean;
      level: "advanced" | "top";
      model: StoredTextModelConfig;
    };
    voice: {
      enabled: boolean;
      level: "advanced" | "top";
      model: StoredTextModelConfig;
    };
  };
  understanding: {
    visual: {
      mode: "native" | "auxiliary";
      model: StoredTextModelConfig;
    };
    audio: {
      mode: "native" | "auxiliary";
      model: StoredTextModelConfig;
    };
  };
  context: {
    minimumMessages: number;
    maximumMessages: number;
  };
  typingCharsPerMinute: number;
  messageCoalesceMs: number;
  wakeups: {
    proactive: {
      enabled: boolean;
      interactionInvalidationWindowMinutes: number;
    };
    passive: {
      enabled: boolean;
      milestonesMinutes: [number, number, number];
    };
  };
}

export interface StoredPrimeWorldRuntimeConfig {
  version: 1;
}

export interface StoredUserRuntimeConfig {
  version: 2;
  sliceFigure: StoredSliceFigureRuntimeConfig;
  primeFigure: StoredPrimeFigureRuntimeConfig;
  primeWorld: StoredPrimeWorldRuntimeConfig;
}

export interface StoredRuntimeConfigPreset<TConfig> {
  id: string;
  name: string;
  config: TConfig;
}

export interface StoredRuntimeConfigPresets {
  sliceFigure: Array<StoredRuntimeConfigPreset<StoredSliceFigureRuntimeConfig>>;
  primeFigure: Array<StoredRuntimeConfigPreset<StoredPrimeFigureRuntimeConfig>>;
}

export type StoredFigureRuntimeConfig =
  | StoredSliceFigureRuntimeConfig
  | StoredPrimeFigureRuntimeConfig
  | StoredPrimeWorldRuntimeConfig;
