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

export class OpenRouterProvider implements AiTextProvider {
  readonly id: string;

  constructor(private readonly config: StoredTextModelConfig) {
    this.id = config.provider;
  }

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
