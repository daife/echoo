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
  version: 1;
  llm: StoredTextModelConfig;
  image: StoredModelEndpointConfig;
  tts: StoredFishAudioConfig;
  context: {
    minimumMessages: number;
    maximumMessages: number;
  };
  typingCharsPerMinute: number;
  messageCoalesceMs: number;
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
