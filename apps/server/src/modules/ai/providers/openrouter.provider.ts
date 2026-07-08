import type { AiTextProvider, ChatCompletionInput, ChatCompletionResult } from "../ai-provider.interface.js";
import { createOpenAiCompatibleChatCompletion } from "./openai-compatible-chat.js";

export class OpenRouterProvider implements AiTextProvider {
  readonly id = "openrouter" as const;

  async createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const sessionId = normalizeSessionId(input.sessionId);

    return createOpenAiCompatibleChatCompletion({
      providerId: this.id,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      completion: input,
      headers: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? process.env.CLIENT_URL ?? "http://localhost:5173",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "Echoo",
        ...(sessionId ? { "x-session-id": sessionId } : {})
      },
      extraBody: sessionId ? { session_id: sessionId } : undefined
    });
  }
}

function normalizeSessionId(sessionId?: string) {
  const trimmed = sessionId?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 256);
}
