import assert from "node:assert/strict";
import test from "node:test";
import type { StoredTextModelConfig } from "../../runtime-config/runtime-config.types.js";
import { OpenRouterProvider } from "./openrouter.provider.js";

interface Charge {
  service: string;
  model: string;
  upstreamRequestId: string;
  upstreamCostUsd: number;
  metadata?: Record<string, unknown>;
}

function deepSeekConfig(
  overrides: Partial<StoredTextModelConfig> = {},
): StoredTextModelConfig {
  return {
    source: "platform",
    routingProvider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "deepseek-secret",
    model: "deepseek/deepseek-v4-flash",
    temperature: 0.2,
    maxTokens: 256,
    reasoningEnabled: false,
    reasoningEffort: "high",
    ...overrides,
  };
}

function fakes(
  pricing = {
    promptUsdPerToken: 0.000001,
    promptCacheReadUsdPerToken: 0.0000001,
    completionUsdPerToken: 0.000002,
  },
) {
  const charges: Charge[] = [];
  const billing = {
    assertPlatformBalance: async () => {},
    chargeUsage: async (charge: Charge) => {
      charges.push(charge);
    },
  };
  const catalog = {
    getEndpointUsagePricing: async () => pricing,
  };
  return { billing, catalog, charges };
}

test("official DeepSeek requests use compatible payloads and local token billing", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  let url = "";
  globalThis.fetch = async (input, init) => {
    url = String(input);
    request = init;
    return new Response(
      JSON.stringify({
        id: "deepseek-request-1",
        choices: [{ message: { content: '{"result":"ok"}' } }],
        usage: {
          prompt_tokens: 10,
          prompt_cache_hit_tokens: 6,
          prompt_cache_miss_tokens: 4,
          completion_tokens: 4,
          total_tokens: 14,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const { billing, catalog, charges } = fakes();
    const provider = new OpenRouterProvider(
      deepSeekConfig(),
      billing as never,
      catalog as never,
    );
    await provider.createChatCompletion({
      model: "deepseek/deepseek-v4-flash",
      sessionId: "sticky-session",
      messages: [{ role: "user", content: "Return a JSON object." }],
      reasoningEnabled: false,
      reasoningEffort: "high",
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "result", schema: { type: "object" } },
      },
    });

    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(
      request?.headers &&
        (request.headers as Record<string, string>)["HTTP-Referer"],
      undefined,
    );
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    assert.equal(body.model, "deepseek-v4-flash");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.provider, undefined);
    assert.equal(body.session_id, undefined);
    assert.equal(body.user_id, "sticky-session");
    assert.equal(charges.length, 1);
    const [charge] = charges;
    assert.ok(Math.abs((charge?.upstreamCostUsd ?? 0) - 0.0000126) < 1e-15);
    assert.deepEqual(
      { ...charge, upstreamCostUsd: 0.0000126 },
      {
        service: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        upstreamRequestId: "deepseek-request-1",
        upstreamCostUsd: 0.0000126,
        metadata: {
          promptTokens: 10,
          promptCacheHitTokens: 6,
          promptCacheMissTokens: 4,
          completionTokens: 4,
          totalTokens: 14,
          promptUsdPerToken: 0.000001,
          promptCacheReadUsdPerToken: 0.0000001,
          completionUsdPerToken: 0.000002,
          directModel: "deepseek-v4-flash",
        },
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official DeepSeek requests require a valid role-specific session ID", async () => {
  const { billing, catalog } = fakes();
  const provider = new OpenRouterProvider(
    deepSeekConfig(),
    billing as never,
    catalog as never,
  );
  await assert.rejects(
    provider.createChatCompletion({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
    /require a session ID/,
  );
});

test("official DeepSeek streaming requests request usage and settle from its final chunk", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(
      'data: {"id":"deepseek-stream-1","choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"id":"deepseek-stream-1","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  try {
    const { billing, catalog, charges } = fakes();
    const provider = new OpenRouterProvider(
      deepSeekConfig({ model: "deepseek-v4-flash" }),
      billing as never,
      catalog as never,
    );
    let text = "";
    for await (const delta of provider.streamChatCompletion({
      model: "deepseek-v4-flash",
      sessionId: "pf-session-d",
      messages: [{ role: "user", content: "Hello" }],
      reasoningEnabled: false,
      reasoningEffort: "high",
    })) {
      text += delta.text ?? "";
    }

    assert.equal(text, "ok");
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.user_id, "pf-session-d");
    assert.equal(charges.length, 1);
    assert.equal(charges[0]?.upstreamCostUsd, 0.000007);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official DeepSeek calls fail before dispatch when its endpoint pricing is missing", async () => {
  const { billing, catalog } = fakes(null as never);
  const provider = new OpenRouterProvider(
    deepSeekConfig(),
    billing as never,
    catalog as never,
  );
  await assert.rejects(
    provider.createChatCompletion({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
    /Sync its deepseek endpoint/,
  );
});
