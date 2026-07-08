import type { AiTextProvider, ChatCompletionInput, ChatCompletionResult, ChatDelta } from "../ai-provider.interface.js";
import { createOpenAiCompatibleChatCompletion, streamOpenAiCompatibleChatCompletion } from "./openai-compatible-chat.js";

export class XaiProvider implements AiTextProvider {
  readonly id = "xai" as const;

  async createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    return createOpenAiCompatibleChatCompletion(this.buildRequest(input));
  }

  streamChatCompletion(input: ChatCompletionInput): AsyncIterable<ChatDelta> {
    return streamOpenAiCompatibleChatCompletion(this.buildRequest(input));
  }

  private buildRequest(input: ChatCompletionInput) {
    return {
      providerId: this.id,
      apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
      completion: input
    };
  }
}
