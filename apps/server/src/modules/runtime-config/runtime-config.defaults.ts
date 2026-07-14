import type { StoredUserRuntimeConfig } from "./runtime-config.types.js";

export function buildRuntimeConfigDefaults(): StoredUserRuntimeConfig {
  const sharedEndpoint = {
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
  };
  return {
    version: 1,
    sliceFigure: {
      version: 1,
      llm: {
        ...sharedEndpoint,
        model: "openai/gpt-4o-mini",
        temperature: 0.8,
        maxTokens: 1200,
      },
      context: {
        minimumRounds: 100,
        maximumRounds: 199,
        memorySummaryRounds: 500,
      },
    },
    primeFigure: {
      version: 1,
      llm: {
        ...sharedEndpoint,
        model: "openai/gpt-4o-mini",
        temperature: 0.4,
        maxTokens: 1600,
      },
      image: {
        ...sharedEndpoint,
        model: "google/gemini-3.1-flash-lite-image",
      },
      tts: {
        provider: "fish-audio",
        apiKey: "",
        referenceId: "",
        model: "s2.1-pro-free",
        httpUrl: "https://api.fish.audio/v1/tts",
        wsUrl: "wss://api.fish.audio/v1/tts/live",
        latency: "balanced",
        chunkLength: 100,
      },
      context: {
        minimumMessages: 150,
        maximumMessages: 249,
      },
      typingCharsPerMinute: 300,
      messageCoalesceMs: 2_000,
    },
    primeWorld: { version: 1 },
  };
}
