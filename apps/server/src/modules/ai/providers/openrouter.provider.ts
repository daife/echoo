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

export class OpenRouterProvider implements AiTextProvider {
  readonly id = "openrouter";

  constructor(
    private readonly config: StoredTextModelConfig,
    private readonly billing = new BillingService(),
  ) {}

  async createChatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    await this.beforePlatformCall();
    const result = await createOpenAiCompatibleChatCompletion(
      this.buildRequest(input),
    );
    await this.settle(result.usage);
    return result;
  }

  async *streamChatCompletion(
    input: ChatCompletionInput,
  ): AsyncIterable<ChatDelta> {
    await this.beforePlatformCall();
    let finalUsage: ChatDelta["usage"];
    for await (const delta of streamOpenAiCompatibleChatCompletion(
      this.buildRequest(input),
    )) {
      if (delta.usage) finalUsage = { ...finalUsage, ...delta.usage };
      yield delta;
    }
    await this.settle(finalUsage);
  }

  private beforePlatformCall() {
    return this.config.source === "platform"
      ? this.billing.assertPlatformBalance()
      : Promise.resolve();
  }

  private async settle(usage?: ChatDelta["usage"]) {
    if (
      this.config.source !== "platform" ||
      !usage?.upstreamRequestId ||
      typeof usage.costUsd !== "number"
    )
      return;
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
    const sessionId = normalizeSessionId(input.sessionId);
    const upstreamProvider = this.config.routingProvider?.trim();

    return {
      providerId: this.id,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      completion: input,
      headers: {
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL ??
          process.env.CLIENT_URL ??
          "http://localhost:5173",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "Echoo",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      extraBody:
        sessionId || upstreamProvider
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
