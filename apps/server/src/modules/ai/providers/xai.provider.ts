import type { AiTextProvider, ChatCompletionInput, ChatCompletionResult } from "../ai-provider.interface.js";
import { createOpenAiCompatibleChatCompletion } from "./openai-compatible-chat.js";

export class XaiProvider implements AiTextProvider {
  readonly id = "xai" as const;

  async createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    return createOpenAiCompatibleChatCompletion({
      providerId: this.id,
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
      completion: input
    });
  }
}
