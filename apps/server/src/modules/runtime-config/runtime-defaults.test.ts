import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import { forcePlatformDefaults } from "./runtime-config.service.js";

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
