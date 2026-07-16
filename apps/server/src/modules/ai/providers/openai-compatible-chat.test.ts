import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAiCompatibleRequestBody,
  createOpenAiCompatibleChatCompletion,
  streamOpenAiCompatibleChatCompletion,
} from "./openai-compatible-chat.js";

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

const structuredCompletion = {
  ...completion,
  messages: [
    { role: "system" as const, content: "Return the requested value." },
    { role: "user" as const, content: "Hello" },
  ],
  responseFormat: {
    type: "json_schema",
    json_schema: {
      name: "result",
      strict: true,
      schema: {
        type: "object",
        properties: { result: { type: "string" } },
        required: ["result"],
        additionalProperties: false,
      },
    },
  },
};

test("downgrades JSON Schema to JSON object for the official DeepSeek API", () => {
  const body = buildOpenAiCompatibleRequestBody({
    providerId: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com/v1",
    completion: structuredCompletion,
  });

  assert.deepEqual(body.response_format, { type: "json_object" });
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.match(messages[0]!.content, /合法的 JSON 对象/);
  assert.match(messages[0]!.content, /"required":\["result"\]/);
});

test("keeps JSON Schema for the initial OpenRouter request", () => {
  const body = buildOpenAiCompatibleRequestBody({
    providerId: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    completion: structuredCompletion,
  });

  assert.equal(
    (body.response_format as Record<string, unknown>).type,
    "json_schema",
  );
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0]!.content, "Return the requested value.");
});

test("adds an explicit JSON instruction when JSON object mode is requested", () => {
  const body = buildOpenAiCompatibleRequestBody({
    providerId: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    completion: {
      ...completion,
      responseFormat: { type: "json_object" },
    },
  });

  assert.deepEqual(body.response_format, { type: "json_object" });
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0]!.role, "system");
  assert.match(messages[0]!.content, /合法的 JSON 对象/);
});

test("retries an unsupported OpenRouter JSON Schema request as JSON object", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({
          error: { message: "This response_format type is unavailable now" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "request-1",
        choices: [{ message: { content: '{"result":"ok"}' } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await createOpenAiCompatibleChatCompletion({
      providerId: "openrouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      completion: structuredCompletion,
    });

    assert.equal(result.text, '{"result":"ok"}');
    assert.equal(bodies.length, 2);
    assert.equal(
      (bodies[0]!.response_format as Record<string, unknown>).type,
      "json_schema",
    );
    assert.deepEqual(bodies[1]!.response_format, { type: "json_object" });
    const fallbackMessages = bodies[1]!.messages as Array<{
      role: string;
      content: string;
    }>;
    assert.match(fallbackMessages[0]!.content, /合法的 JSON 对象/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the same OpenRouter JSON object fallback for streaming requests", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({
          error: { message: "This response_format type is unavailable now" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"{\\"result\\":\\"ok\\"}"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  try {
    let text = "";
    for await (const delta of streamOpenAiCompatibleChatCompletion({
      providerId: "openrouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      completion: structuredCompletion,
    })) {
      text += delta.text ?? "";
    }

    assert.equal(text, '{"result":"ok"}');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!.stream, true);
    assert.equal(bodies[1]!.stream, true);
    assert.deepEqual(bodies[1]!.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("includes streaming usage for the official DeepSeek API", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      'data: {"id":"request-1","choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"id":"request-1","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  try {
    for await (const _delta of streamOpenAiCompatibleChatCompletion({
      providerId: "openrouter",
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      completion,
    })) {
      // Consume the stream so the mocked request is completed.
    }

    assert.deepEqual(body?.stream_options, { include_usage: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
