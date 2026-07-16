import type {
  AiTextProvider,
  ChatCompletionInput,
  ChatCompletionResult,
  ChatDelta,
} from "../ai-provider.interface.js";
import type { StoredTextModelConfig } from "../../runtime-config/runtime-config.types.js";
import {
  createOpenAiCompatibleChatCompletion,
  streamOpenAiCompatibleChatCompletion,
} from "./openai-compatible-chat.js";
import { BillingService } from "../../billing/billing.service.js";
import { environment } from "../../../infra/config/environment.js";
import {
  PlatformCatalogService,
  type EndpointUsagePricing,
} from "../../platform-catalog/platform-catalog.service.js";
import {
  isPlatformDeepSeekRoute,
  toOfficialDeepSeekModelId,
} from "../platform-deepseek.js";

export class OpenRouterProvider implements AiTextProvider {
  readonly id = "openrouter";

  constructor(
    private readonly config: StoredTextModelConfig,
    private readonly billing = new BillingService(),
    private readonly catalog = new PlatformCatalogService(),
  ) {}

  async createChatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    const deepSeekPricing = await this.beforePlatformCall();
    const result = await createOpenAiCompatibleChatCompletion(
      this.buildRequest(input),
    );
    await this.settle(result.usage, deepSeekPricing);
    return result;
  }

  async *streamChatCompletion(
    input: ChatCompletionInput,
  ): AsyncIterable<ChatDelta> {
    const deepSeekPricing = await this.beforePlatformCall();
    let finalUsage: ChatDelta["usage"];
    for await (const delta of streamOpenAiCompatibleChatCompletion(
      this.buildRequest(input),
    )) {
      if (delta.usage) finalUsage = { ...finalUsage, ...delta.usage };
      yield delta;
    }
    await this.settle(finalUsage, deepSeekPricing);
  }

  private async beforePlatformCall(): Promise<
    EndpointUsagePricing | undefined
  > {
    if (this.config.source !== "platform") return undefined;
    await this.billing.assertPlatformBalance();
    if (!isPlatformDeepSeekRoute(this.config)) return undefined;
    if (!this.config.apiKey)
      throw new Error("PLATFORM_DEEPSEEK_API_KEY is not configured.");

    const pricing = await this.catalog.getEndpointUsagePricing(
      this.config.model,
      "deepseek",
    );
    if (!pricing)
      throw new Error(
        `DeepSeek pricing is unavailable for ${this.config.model}. Sync its deepseek endpoint before using the official API.`,
      );
    return pricing;
  }

  private async settle(
    usage: ChatDelta["usage"] | undefined,
    deepSeekPricing?: EndpointUsagePricing,
  ) {
    if (this.config.source !== "platform") return;
    if (deepSeekPricing) {
      if (
        !usage?.upstreamRequestId ||
        typeof usage.promptTokens !== "number" ||
        typeof usage.completionTokens !== "number"
      )
        throw new Error(
          "DeepSeek official API did not return the request ID and complete token usage required for platform billing.",
        );
      const upstreamCostUsd =
        usage.promptTokens * deepSeekPricing.promptUsdPerToken +
        usage.completionTokens * deepSeekPricing.completionUsdPerToken;
      await this.billing.chargeUsage({
        service: "deepseek",
        model: this.config.model,
        upstreamRequestId: usage.upstreamRequestId,
        upstreamCostUsd,
        metadata: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          promptUsdPerToken: deepSeekPricing.promptUsdPerToken,
          completionUsdPerToken: deepSeekPricing.completionUsdPerToken,
          directModel: toOfficialDeepSeekModelId(this.config.model),
        },
      });
      return;
    }
    if (!usage?.upstreamRequestId || typeof usage.costUsd !== "number") return;
    await this.billing.chargeUsage({
      service: "openrouter",
      model: this.config.model,
      upstreamRequestId: usage.upstreamRequestId,
      upstreamCostUsd: usage.costUsd,
      metadata: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    });
  }

  private buildRequest(input: ChatCompletionInput) {
    const useOfficialDeepSeek = isPlatformDeepSeekRoute(this.config);
    const sessionId = normalizeSessionId(input.sessionId);
    const deepSeekUserId = useOfficialDeepSeek
      ? normalizeDeepSeekUserId(input.sessionId)
      : undefined;
    const upstreamProvider = this.config.routingProvider?.trim();

    return {
      providerId: this.id,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      completion: useOfficialDeepSeek
        ? { ...input, model: toOfficialDeepSeekModelId(input.model) }
        : input,
      headers: useOfficialDeepSeek
        ? undefined
        : {
            "HTTP-Referer": environment.openRouterSiteUrl,
            "X-OpenRouter-Title": environment.openRouterAppTitle,
            ...(sessionId ? { "x-session-id": sessionId } : {}),
          },
      extraBody: useOfficialDeepSeek
        ? { user_id: deepSeekUserId }
        : sessionId || upstreamProvider
          ? {
              ...(sessionId ? { session_id: sessionId } : {}),
              ...(upstreamProvider
                ? { provider: { only: [upstreamProvider] } }
                : {}),
            }
          : undefined,
    };
  }
}

function normalizeSessionId(sessionId?: string) {
  const trimmed = sessionId?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 256);
}

function normalizeDeepSeekUserId(sessionId?: string) {
  const trimmed = sessionId?.trim();
  if (!trimmed)
    throw new Error("DeepSeek official API requests require a session ID.");
  if (trimmed.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(trimmed))
    throw new Error(
      "DeepSeek official API session IDs must contain only letters, numbers, hyphens, or underscores and be at most 512 characters.",
    );
  return trimmed;
}
