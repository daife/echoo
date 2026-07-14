import { getFigureContextWindowConfig } from "../../infra/config/context-window-config.js";
import type { StoredUserRuntimeConfig } from "./runtime-config.types.js";

export function buildRuntimeConfigDefaults(options?: {
  includeEnvironmentSecrets?: boolean;
}): StoredUserRuntimeConfig {
  const context = getFigureContextWindowConfig();
  const includeSecrets = options?.includeEnvironmentSecrets ?? true;
  const sharedEndpoint = {
    provider: "openrouter",
    ...(process.env.OPENROUTER_PROVIDER?.trim()
      ? { routingProvider: process.env.OPENROUTER_PROVIDER.trim() }
      : {}),
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey: includeSecrets ? (process.env.OPENROUTER_API_KEY ?? "") : "",
  };
  return {
    version: 1,
    sliceFigure: {
      version: 1,
      llm: {
        ...sharedEndpoint,
        model: process.env.DEFAULT_TEXT_MODEL ?? "openai/gpt-4o-mini",
        temperature: finiteNumber(process.env.DEFAULT_TEXT_TEMPERATURE, 0.8),
        maxTokens: positiveInteger(process.env.DEFAULT_TEXT_MAX_TOKENS, 1200),
      },
      context: {
        minimumRounds: context.sliceFigureRounds.minimum,
        maximumRounds: context.sliceFigureRounds.maximum,
        memorySummaryRounds: context.sliceFigureMemorySummaryRounds,
      },
    },
    primeFigure: {
      version: 1,
      llm: {
        ...sharedEndpoint,
        model: process.env.DEFAULT_TEXT_MODEL ?? "openai/gpt-4o-mini",
        temperature: finiteNumber(process.env.DEFAULT_PRIME_TEMPERATURE, 0.4),
        maxTokens: positiveInteger(process.env.DEFAULT_PRIME_MAX_TOKENS, 1600),
      },
      image: {
        ...sharedEndpoint,
        model:
          process.env.DEFAULT_PRIME_IMAGE_MODEL ??
          "google/gemini-3.1-flash-lite-image",
      },
      tts: {
        provider: "fish-audio",
        apiKey: includeSecrets ? (process.env.FISH_AUDIO_API_KEY ?? "") : "",
        referenceId: process.env.FISH_AUDIO_REFERENCE_ID ?? "",
        model: process.env.FISH_AUDIO_MODEL ?? "s2.1-pro-free",
        httpUrl:
          process.env.FISH_AUDIO_TTS_URL ?? "https://api.fish.audio/v1/tts",
        wsUrl:
          process.env.FISH_AUDIO_WS_URL ?? "wss://api.fish.audio/v1/tts/live",
        latency: process.env.FISH_AUDIO_LATENCY ?? "balanced",
        chunkLength: positiveInteger(process.env.FISH_AUDIO_CHUNK_LENGTH, 100),
      },
      context: {
        minimumMessages: context.primeFigureMessages.minimum,
        maximumMessages: context.primeFigureMessages.maximum,
      },
      typingCharsPerMinute: positiveNumber(
        process.env.PRIME_TYPING_CHARS_PER_MINUTE,
        300,
      ),
      messageCoalesceMs: nonnegativeNumber(
        process.env.PRIME_MESSAGE_COALESCE_MS,
        2_000,
      ),
    },
    primeWorld: { version: 1 },
  };
}

function finiteNumber(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(raw: string | undefined, fallback: number) {
  const value = finiteNumber(raw, fallback);
  return value > 0 ? value : fallback;
}

function nonnegativeNumber(raw: string | undefined, fallback: number) {
  const value = finiteNumber(raw, fallback);
  return value >= 0 ? value : fallback;
}

function positiveInteger(raw: string | undefined, fallback: number) {
  return Math.max(1, Math.trunc(positiveNumber(raw, fallback)));
}
