import type { StoredUserRuntimeConfig } from "./runtime-config.types.js";

export function buildRuntimeConfigDefaults(): StoredUserRuntimeConfig {
  const sharedEndpoint = {
    source: "platform" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
  };
  return {
    version: 2,
    sliceFigure: {
      version: 2,
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
      version: 6,
      decisionModel: {
        ...sharedEndpoint,
        model: "google/gemini-2.5-flash-lite",
        temperature: 0.4,
        maxTokens: 1600,
      },
      outputs: {
        image: {
          enabled: true,
          guidanceLevel: "medium",
          generator: {
            ...sharedEndpoint,
            model: "google/gemini-3.1-flash-lite-image",
          },
          parameters: { resolution: "1K" },
        },
        voice: {
          enabled: true,
          guidanceLevel: "medium",
          tts: {
            source: "platform",
            apiKey: "",
            referenceId: "",
            model: "s2.1-pro-free",
            httpUrl: "https://api.fish.audio/v1/tts",
            wsUrl: "wss://api.fish.audio/v1/tts/live",
            latency: "balanced",
            chunkLength: 100,
          },
        },
        sticker: {
          enabled: false,
        },
        transfer: {
          enabled: false,
        },
      },
      optimization: {
        image: {
          enabled: false,
          level: "advanced",
          model: {
            ...sharedEndpoint,
            model: "openai/gpt-4o-mini",
            temperature: 0.2,
            maxTokens: 2400,
          },
        },
        voice: {
          enabled: false,
          level: "advanced",
          model: {
            ...sharedEndpoint,
            model: "openai/gpt-4o-mini",
            temperature: 0.2,
            maxTokens: 1600,
          },
        },
      },
      understanding: {
        visual: {
          mode: "native",
          model: {
            ...sharedEndpoint,
            model: "openai/gpt-4o-mini",
            temperature: 0.1,
            maxTokens: 2400,
          },
        },
        audio: {
          mode: "native",
          model: {
            ...sharedEndpoint,
            model: "google/gemini-2.5-flash-lite",
            temperature: 0.1,
            maxTokens: 2400,
          },
        },
      },
      context: {
        minimumMessages: 150,
        maximumMessages: 249,
      },
      typingCharsPerMinute: 300,
      messageCoalesceMs: 2_000,
      wakeups: {
        proactive: {
          enabled: false,
          interactionInvalidationWindowMinutes: 10,
        },
        passive: {
          enabled: false,
          milestonesMinutes: [15, 180, 1_440],
        },
      },
    },
    primeWorld: { version: 1 },
  };
}
