import assert from "node:assert/strict";
import test from "node:test";
import { modelSupportsRecommendationCategory } from "./platform-catalog.service.js";

test("filters prime decision recommendations by required base capabilities", () => {
  assert.equal(
    modelSupportsRecommendationCategory("prime_decision", {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportedParameters: ["tools", "response_format"],
    }),
    true,
  );
  assert.equal(
    modelSupportsRecommendationCategory("prime_decision", {
      inputModalities: ["text", "image", "audio"],
      outputModalities: ["text"],
      supportedParameters: ["tools"],
    }),
    false,
  );
});

test("does not require optional image or audio input for prime decisions", () => {
  assert.equal(
    modelSupportsRecommendationCategory("prime_decision", {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportedParameters: ["tools", "structured_outputs"],
    }),
    true,
  );
});

test("matches modality-specific recommendation categories", () => {
  assert.equal(
    modelSupportsRecommendationCategory("visual_understanding", {
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      supportedParameters: [],
    }),
    true,
  );
  assert.equal(
    modelSupportsRecommendationCategory("audio_understanding", {
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      supportedParameters: [],
    }),
    false,
  );
  assert.equal(
    modelSupportsRecommendationCategory("image_generation", {
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedParameters: [],
    }),
    true,
  );
});

test("fish audio IDs remain manual because they are outside OpenRouter catalog", () => {
  assert.equal(
    modelSupportsRecommendationCategory("fish_tts", {
      inputModalities: ["text"],
      outputModalities: ["audio"],
      supportedParameters: [],
    }),
    false,
  );
});
