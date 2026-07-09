export type AiProviderId = "openrouter" | "xai";

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionInput {
  model: string;
  /**
   * Persistent conversation/session id. OpenRouter uses this as session_id for sticky routing.
   */
  sessionId?: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  providerId: AiProviderId;
  model: string;
  text: string;
}

export interface ChatDelta {
  text?: string;
}

export interface AiTextProvider {
  id: AiProviderId;
  createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult>;
  streamChatCompletion?(input: ChatCompletionInput): AsyncIterable<ChatDelta>;
}
