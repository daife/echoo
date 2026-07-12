import type {
  AiTextProvider,
  ChatCompletionInput,
  ChatCompletionResult,
  ChatDelta,
} from "../ai-provider.interface.js";
import {
  createOpenAiCompatibleChatCompletion,
  streamOpenAiCompatibleChatCompletion,
} from "./openai-compatible-chat.js";

export class OpenRouterProvider implements AiTextProvider {
  readonly id = "openrouter" as const;

  async createChatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    return createOpenAiCompatibleChatCompletion(this.buildRequest(input));
  }

  streamChatCompletion(input: ChatCompletionInput): AsyncIterable<ChatDelta> {
    return streamOpenAiCompatibleChatCompletion(this.buildRequest(input));
  }

  private buildRequest(input: ChatCompletionInput) {
    const sessionId = normalizeSessionId(input.sessionId);
    const upstreamProvider = process.env.OPENROUTER_PROVIDER?.trim();

    return {
      providerId: this.id,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
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
