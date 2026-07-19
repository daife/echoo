import assert from "node:assert/strict";
import test from "node:test";
import { userRuntimeConfigPatchSchema } from "@echoo/shared";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import {
  forcePlatformDefaults,
  resolvePlatformOpenRouterEndpoint,
  resolvePlatformTextEndpoint,
} from "./runtime-config.service.js";

test("accepts STT audio understanding patches and preserves STT settings", () => {
  const result = userRuntimeConfigPatchSchema.parse({
    primeFigure: {
      understanding: {
        audio: {
          mode: "stt",
          stt: {
            source: "custom",
            apiKey: "stt-secret",
            httpUrl: "https://fish.example/v1/asr",
            language: "zh",
          },
        },
      },
    },
  });

  assert.deepEqual(result.primeFigure?.understanding?.audio, {
    mode: "stt",
    stt: {
      source: "custom",
      apiKey: "stt-secret",
      httpUrl: "https://fish.example/v1/asr",
      language: "zh",
    },
  });
});

test("administrator defaults are forced to platform sources without secrets", () => {
  const input = buildRuntimeConfigDefaults();
  input.sliceFigure.llm = {
    ...input.sliceFigure.llm,
    source: "custom",
    baseUrl: "https://private.example/v1",
    apiKey: "private-key",
  };
  input.primeFigure.outputs.voice.tts = {
    ...input.primeFigure.outputs.voice.tts,
    source: "custom",
    apiKey: "fish-secret",
    httpUrl: "https://private.example/tts",
    wsUrl: "wss://private.example/tts",
  };
  input.primeFigure.understanding.audio.stt = {
    source: "custom",
    apiKey: "stt-secret",
    httpUrl: "https://private.example/asr",
    language: "zh",
  };

  const result = forcePlatformDefaults(input);
  assert.equal(result.sliceFigure.llm.source, "platform");
  assert.equal(result.sliceFigure.version, 3);
  assert.equal(result.sliceFigure.replyAutoSegment, false);
  assert.equal(result.sliceFigure.llm.apiKey, "");
  assert.equal(result.sliceFigure.llm.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(result.primeFigure.outputs.voice.tts.source, "platform");
  assert.equal(result.primeFigure.version, 9);
  assert.equal(result.primeFigure.outputs.voice.requestStreaming, false);
  assert.equal(result.primeFigure.outputs.voice.autoPlay, false);
  assert.equal(result.primeFigure.outputs.voice.tts.apiKey, "");
  assert.deepEqual(result.primeFigure.outputs.image.parameters, {
    resolution: "1K",
  });
  assert.equal(
    result.primeFigure.outputs.voice.tts.httpUrl,
    "https://api.fish.audio/v1/tts",
  );
  assert.deepEqual(result.primeFigure.understanding.audio.stt, {
    source: "platform",
    apiKey: "",
    httpUrl: "https://api.fish.audio/v1/asr",
    language: "zh",
  });
});

test("built-in new-user defaults use the configured Google AI Studio models", () => {
  const defaults = buildRuntimeConfigDefaults();
  const expectedTextModel = "google/gemini-3.1-flash-lite";
  const textModels = [
    defaults.sliceFigure.llm,
    defaults.primeFigure.decisionModel,
    defaults.primeFigure.optimization.image.model,
    defaults.primeFigure.optimization.voice.model,
    defaults.primeFigure.understanding.visual.model,
    defaults.primeFigure.understanding.audio.model,
  ];

  for (const model of textModels) {
    assert.equal(model.model, expectedTextModel);
    assert.equal(model.temperature, 0.9);
    assert.equal(model.routingProvider, "google-ai-studio");
  }
  assert.equal(
    defaults.primeFigure.outputs.image.generator.model,
    "google/gemini-3.1-flash-lite-image",
  );
  assert.equal(
    defaults.primeFigure.outputs.image.generator.routingProvider,
    "google-ai-studio",
  );
  assert.equal(
    defaults.primeFigure.outputs.voice.tts.referenceId,
    "5671e9d40d7a48e1b81e78ff58359903",
  );
});

test("platform DeepSeek routes use the official endpoint and dedicated key", () => {
  const result = resolvePlatformTextEndpoint({
    source: "platform" as const,
    routingProvider: " DeepSeek ",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: "deepseek/deepseek-v4-flash",
  });
  assert.equal(result.baseUrl, "https://api.deepseek.com");
  assert.notEqual(result.apiKey, undefined);
});

test("non-text platform endpoints keep the OpenRouter route", () => {
  const result = resolvePlatformOpenRouterEndpoint({
    source: "platform" as const,
    routingProvider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek/deepseek-v4-flash",
  });
  assert.equal(result.baseUrl, "https://openrouter.ai/api/v1");
});
