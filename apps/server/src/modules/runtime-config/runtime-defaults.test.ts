import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import {
  forcePlatformDefaults,
  resolvePlatformOpenRouterEndpoint,
  resolvePlatformTextEndpoint,
} from "./runtime-config.service.js";

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

  const result = forcePlatformDefaults(input);
  assert.equal(result.sliceFigure.llm.source, "platform");
  assert.equal(result.sliceFigure.llm.apiKey, "");
  assert.equal(result.sliceFigure.llm.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(result.primeFigure.outputs.voice.tts.source, "platform");
  assert.equal(result.primeFigure.outputs.voice.tts.apiKey, "");
  assert.equal(
    result.primeFigure.outputs.voice.tts.httpUrl,
    "https://api.fish.audio/v1/tts",
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
