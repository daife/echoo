import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterImageGenerationService } from "./openrouter-image-generation.service.js";

const billing = {
  assertPlatformBalance: async () => {},
  chargeUsage: async () => {},
};

test("GPT Image 2 uses the dedicated Images API and low quality", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const charges: Array<{ upstreamRequestId: string; upstreamCostUsd: number }> =
    [];
  const fetcher: typeof fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("image").toString("base64"),
            media_type: "image/png",
          },
        ],
        usage: { cost: 0.01 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const service = new OpenRouterImageGenerationService(
    {
      source: "platform",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret",
      model: "openai/gpt-image-2",
    },
    { quality: "low" },
    fetcher,
    {
      assertPlatformBalance: async () => {},
      chargeUsage: async (charge: {
        upstreamRequestId: string;
        upstreamCostUsd: number;
      }) => {
        charges.push(charge);
      },
    } as never,
  );

  await service.generate({
    prompt: "portrait 【推荐比例】16:9",
    references: [],
  });

  assert.equal(url, "https://openrouter.ai/api/v1/images");
  assert.equal(body.quality, "low");
  assert.equal(body.aspect_ratio, undefined);
  assert.equal(body.prompt, "portrait 【推荐比例】16:9");
  assert.equal(charges.length, 1);
  assert.equal(charges[0]?.upstreamCostUsd, 0.01);
  assert.match(charges[0]?.upstreamRequestId ?? "", /^image_/);
});

test("Gemini Lite uses 1K resolution without forcing an aspect ratio", async () => {
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        data: [{ b64_json: Buffer.from("image").toString("base64") }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const service = new OpenRouterImageGenerationService(
    {
      source: "platform",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret",
      model: "google/gemini-3.1-flash-lite-image",
    },
    { resolution: "1K" },
    fetcher,
    billing as never,
  );

  await service.generate({
    prompt: "landscape 【推荐比例】16:9",
    references: [],
  });

  assert.equal(body.resolution, "1K");
  assert.equal(body.aspect_ratio, undefined);
});

test("custom image parameters pass through without overriding managed fields", async () => {
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("image").toString("base64"),
            media_type: "image/webp",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const service = new OpenRouterImageGenerationService(
    {
      source: "custom",
      baseUrl: "https://images.example/v1",
      apiKey: "secret",
      model: "vendor/custom-image",
    },
    {
      output_format: "webp",
      seed: 42,
      model: "untrusted/model",
      prompt: "untrusted prompt",
      provider: { only: ["untrusted"] },
      input_references: [],
      stream: true,
    },
    fetcher,
    billing as never,
  );

  const image = await service.generate({
    prompt: "paint this",
    references: [{ mimeType: "image/png", data: Buffer.from("reference") }],
  });

  assert.equal(body.output_format, "webp");
  assert.equal(body.seed, 42);
  assert.equal(body.model, "vendor/custom-image");
  assert.equal(body.prompt, "paint this");
  assert.equal(body.provider, undefined);
  assert.equal(body.stream, undefined);
  assert.deepEqual(body.input_references, [
    {
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${Buffer.from("reference").toString("base64")}`,
      },
    },
  ]);
  assert.equal(image.mimeType, "image/webp");
});
