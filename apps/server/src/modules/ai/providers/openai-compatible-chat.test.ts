import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenAiCompatibleRequestBody } from "./openai-compatible-chat.js";

const completion = {
  model: "deepseek-v4-pro",
  messages: [{ role: "user" as const, content: "Hello" }],
  reasoningMode: "disabled" as const,
};

test("uses DeepSeek's thinking switch when reasoning is disabled", () => {
  const body = buildOpenAiCompatibleRequestBody({
    providerId: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com/v1",
    completion,
  });

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning, undefined);
  assert.equal(body.reasoning_effort, undefined);
});

test("uses OpenRouter's unified reasoning switch when reasoning is disabled", () => {
  const body = buildOpenAiCompatibleRequestBody({
    providerId: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    completion,
  });

  assert.deepEqual(body.reasoning, { effort: "none", exclude: true });
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.thinking, undefined);
});
