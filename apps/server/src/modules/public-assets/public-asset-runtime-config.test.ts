import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeConfigDefaults } from "../runtime-config/runtime-config.defaults.js";
import { sanitizeRuntimeRecommendation } from "./public-asset.service.js";

test("published runtime recommendations omit every credential and endpoint", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.decisionModel.apiKey = "platform-secret";
  config.decisionModel.baseUrl = "https://internal.example/v1";
  config.outputs.voice.tts.apiKey = "voice-secret";
  config.outputs.voice.tts.httpUrl = "https://internal.example/tts";
  config.outputs.voice.tts.wsUrl = "wss://internal.example/tts";

  const result = sanitizeRuntimeRecommendation("prime-figure", config);
  assert.ok(result);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("platform-secret"), false);
  assert.equal(serialized.includes("voice-secret"), false);
  assert.equal(serialized.includes("internal.example"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("baseUrl"), false);
  assert.equal(serialized.includes("httpUrl"), false);
  assert.equal(serialized.includes("wsUrl"), false);
});

test("one custom endpoint removes the entire recommendation", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.optimization.image.model.source = "custom";
  config.optimization.image.model.apiKey = "private-key";
  config.optimization.image.model.baseUrl = "https://private.example/v1";

  assert.equal(sanitizeRuntimeRecommendation("prime-figure", config), null);
});

test("slice recommendations keep portable behavior settings", () => {
  const config = buildRuntimeConfigDefaults().sliceFigure;
  const result = sanitizeRuntimeRecommendation("slice-figure", config);

  assert.ok(result);
  assert.equal(result.assetType, "slice-figure");
  assert.deepEqual(result.config.context, config.context);
  assert.equal(result.config.replyAutoSegment, config.replyAutoSegment);
});
