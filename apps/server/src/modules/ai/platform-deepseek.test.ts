import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlatformDeepSeekRoute,
  toOfficialDeepSeekModelId,
} from "./platform-deepseek.js";

test("only platform configurations with the DeepSeek slug use the official route", () => {
  assert.equal(
    isPlatformDeepSeekRoute({
      source: "platform",
      routingProvider: " DeepSeek ",
    }),
    true,
  );
  assert.equal(
    isPlatformDeepSeekRoute({
      source: "platform",
      routingProvider: "deepseek-ai",
    }),
    false,
  );
  assert.equal(
    isPlatformDeepSeekRoute({ source: "custom", routingProvider: "deepseek" }),
    false,
  );
});

test("only removes the leading OpenRouter DeepSeek namespace", () => {
  assert.equal(
    toOfficialDeepSeekModelId("deepseek/deepseek-v4-flash"),
    "deepseek-v4-flash",
  );
  assert.equal(
    toOfficialDeepSeekModelId("deepseek-v4-flash"),
    "deepseek-v4-flash",
  );
});
