export interface ImageGenerationReference {
  mimeType: string;
  data: Buffer;
}

export interface GeneratedImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: Buffer;
  model: string;
}
import type { StoredModelEndpointConfig } from "../runtime-config/runtime-config.types.js";

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      images?: Array<{
        image_url?: { url?: string };
      }>;
    };
  }>;
  error?: { message?: string };
  message?: string;
}

export class OpenRouterImageGenerationService {
  constructor(
    private readonly config: StoredModelEndpointConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(input: {
    prompt: string;
    references: ImageGenerationReference[];
  }): Promise<GeneratedImage> {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error("Image generation API key is not configured.");
    const model = this.config.model;
    const upstreamProvider = this.config.routingProvider?.trim();
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const response = await this.fetcher(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL ??
          process.env.CLIENT_URL ??
          "http://localhost:5173",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "Echoo",
      },
      body: JSON.stringify({
        model,
        ...(upstreamProvider ? { provider: { only: [upstreamProvider] } } : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: input.prompt },
              ...input.references.map((reference) => ({
                type: "image_url",
                image_url: {
                  url: `data:${reference.mimeType};base64,${reference.data.toString("base64")}`,
                },
              })),
            ],
          },
        ],
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio: extractAspectRatio(input.prompt) ?? "3:4",
          image_size: "1K",
        },
      }),
    });
    const payload = (await response.json()) as OpenRouterImageResponse;
    if (!response.ok) {
      throw new Error(
        `OpenRouter image generation failed: ${payload.error?.message ?? payload.message ?? response.statusText}`,
      );
    }
    const imageUrl = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl)
      throw new Error("OpenRouter image generation returned no image data.");
    const mimeType = normalizeImageMimeType(readDataUrlMimeType(imageUrl));
    const data = Buffer.from(stripDataUrlPrefix(imageUrl), "base64");
    if (!data.length)
      throw new Error("OpenRouter image generation returned an empty image.");
    return { mimeType, data, model };
  }
}

function normalizeImageMimeType(value?: string): GeneratedImage["mimeType"] {
  if (value === "image/jpeg" || value === "image/webp") return value;
  return "image/png";
}

function stripDataUrlPrefix(value: string) {
  const commaIndex = value.indexOf(",");
  return value.startsWith("data:") && commaIndex >= 0
    ? value.slice(commaIndex + 1)
    : value;
}

function readDataUrlMimeType(value: string) {
  return value.match(/^data:([^;,]+)[;,]/)?.[1];
}

function extractAspectRatio(prompt: string) {
  const section = prompt.match(/【推荐比例】([\s\S]*?)$/)?.[1] ?? prompt;
  return section.match(/\b(1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9)\b/)?.[1];
}
