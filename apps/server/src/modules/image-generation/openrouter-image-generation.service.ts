import { randomUUID } from "node:crypto";

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
import { BillingService } from "../billing/billing.service.js";
import { environment } from "../../infra/config/environment.js";

interface OpenRouterImageResponse {
  id?: string;
  data?: Array<{
    b64_json?: string;
    media_type?: string;
  }>;
  usage?: {
    cost?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
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
    private readonly parameters: Record<string, unknown> = {},
    private readonly fetcher: typeof fetch = fetch,
    private readonly billing = new BillingService(),
  ) {}

  async generate(input: {
    prompt: string;
    references: ImageGenerationReference[];
    sessionId?: string;
  }): Promise<GeneratedImage> {
    if (this.config.source === "platform")
      await this.billing.assertPlatformBalance();
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error("Image generation API key is not configured.");
    const model = this.config.model;
    const upstreamProvider = this.config.routingProvider?.trim();
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const configuredParameters = sanitizeImageParameters(this.parameters);
    const response = await this.fetcher(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": environment.openRouterSiteUrl,
        "X-OpenRouter-Title": environment.openRouterAppTitle,
        ...(input.sessionId ? { "x-session-id": input.sessionId } : {}),
      },
      body: JSON.stringify({
        ...configuredParameters,
        model,
        ...(upstreamProvider ? { provider: { only: [upstreamProvider] } } : {}),
        prompt: input.prompt,
        ...(input.references.length
          ? {
              input_references: input.references.map((reference) => ({
                type: "image_url",
                image_url: {
                  url: `data:${reference.mimeType};base64,${reference.data.toString("base64")}`,
                },
              })),
            }
          : {}),
      }),
    });
    const payload = (await response.json()) as OpenRouterImageResponse;
    if (!response.ok) {
      throw new Error(
        `OpenRouter image generation failed: ${payload.error?.message ?? payload.message ?? response.statusText}`,
      );
    }
    const dedicatedImage = payload.data?.[0];
    const imageUrl = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const encoded = dedicatedImage?.b64_json ?? imageUrl;
    if (!encoded)
      throw new Error("OpenRouter image generation returned no image data.");
    const mimeType = normalizeImageMimeType(
      dedicatedImage?.media_type ?? readDataUrlMimeType(encoded),
    );
    const data = Buffer.from(stripDataUrlPrefix(encoded), "base64");
    if (!data.length)
      throw new Error("OpenRouter image generation returned an empty image.");
    if (
      this.config.source === "platform" &&
      typeof payload.usage?.cost === "number"
    )
      await this.billing.chargeUsage({
        service: "openrouter",
        model,
        upstreamRequestId:
          payload.id ??
          response.headers.get("x-request-id") ??
          `image_${randomUUID()}`,
        upstreamCostUsd: payload.usage.cost,
        metadata: {
          kind: "image_generation",
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
        },
      });
    return { mimeType, data, model };
  }
}

function sanitizeImageParameters(parameters: Record<string, unknown>) {
  const result = { ...parameters };
  for (const reserved of [
    "model",
    "prompt",
    "input_references",
    "provider",
    "stream",
  ])
    delete result[reserved];
  return result;
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
