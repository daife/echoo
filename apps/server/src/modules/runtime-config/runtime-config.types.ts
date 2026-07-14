export interface StoredModelEndpointConfig {
  provider: string;
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
  provider: string;
  apiKey: string;
  referenceId: string;
  model: string;
  httpUrl: string;
  wsUrl: string;
  latency: string;
  chunkLength: number;
}

export interface StoredSliceFigureRuntimeConfig {
  version: 1;
  llm: StoredTextModelConfig;
  context: {
    minimumRounds: number;
    maximumRounds: number;
    memorySummaryRounds: number;
  };
}

export interface StoredPrimeFigureRuntimeConfig {
  version: 3;
  decisionModel: StoredTextModelConfig;
  outputs: {
    image: {
      enabled: boolean;
      guidanceLevel: "basic" | "medium" | "advanced";
      generator: StoredModelEndpointConfig;
    };
    voice: {
      enabled: boolean;
      guidanceLevel: "basic" | "medium" | "advanced";
      tts: StoredFishAudioConfig;
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
  version: 1;
  sliceFigure: StoredSliceFigureRuntimeConfig;
  primeFigure: StoredPrimeFigureRuntimeConfig;
  primeWorld: StoredPrimeWorldRuntimeConfig;
}

export type StoredFigureRuntimeConfig =
  | StoredSliceFigureRuntimeConfig
  | StoredPrimeFigureRuntimeConfig
  | StoredPrimeWorldRuntimeConfig;
