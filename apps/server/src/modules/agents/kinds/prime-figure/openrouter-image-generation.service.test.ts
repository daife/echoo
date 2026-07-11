import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterImageGenerationService } from "../../../image-generation/openrouter-image-generation.service.js";

test("OpenRouter image generation sends persistent references and decodes the result", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: `data:image/png;base64,${Buffer.from("generated-image").toString("base64")}`,
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
  try {
    const result = await new OpenRouterImageGenerationService(fetcher).generate(
      {
        prompt:
          "【正向提示词】手机随手拍。\n【负向提示词】不要第三人称。\n【机位与身体逻辑检查】- 第一视角。\n【推荐比例】9:16",
        references: [
          { mimeType: "image/jpeg", data: Buffer.from("reference-image") },
        ],
      },
    );

    assert.equal(requestUrl, "https://openrouter.test/api/v1/chat/completions");
    assert.equal(requestBody.model, "google/gemini-3.1-flash-lite-image");
    assert.deepEqual(requestBody.modalities, ["image", "text"]);
    assert.deepEqual(requestBody.image_config, {
      aspect_ratio: "9:16",
      image_size: "1K",
    });
    const messages = requestBody.messages as Array<{
      role: string;
      content: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
    }>;
    assert.equal(messages[0]?.role, "user");
    assert.match(messages[0]?.content[0]?.text ?? "", /手机随手拍/);
    const reference = messages[0]?.content[1] as {
      type: string;
      image_url: { url: string };
    };
    assert.equal(reference.type, "image_url");
    assert.equal(
      reference.image_url.url,
      `data:image/jpeg;base64,${Buffer.from("reference-image").toString("base64")}`,
    );
    assert.equal(result.mimeType, "image/png");
    assert.deepEqual(result.data, Buffer.from("generated-image"));
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
  }
});
