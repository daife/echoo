export type AiProviderId = string;

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: { url: string };
}

export interface VideoUrlContentPart {
  type: "video_url";
  video_url: { url: string };
}

export interface InputAudioContentPart {
  type: "input_audio";
  input_audio: { data: string; format: string };
}

export type ChatCompletionContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | VideoUrlContentPart
  | InputAudioContentPart;

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatCompletionContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
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
  responseFormat?: Record<string, unknown>;
  tools?: ChatToolDefinition[];
  toolChoice?: "none" | "auto" | "required" | Record<string, unknown>;
  reasoningMode?: "disabled";
}

export interface ChatCompletionResult {
  providerId: AiProviderId;
  model: string;
  text: string;
  toolCalls?: ChatToolCall[];
  usage?: AiUsage;
}

export interface AiUsage {
  upstreamRequestId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ChatDelta {
  text?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
  usage?: AiUsage;
}

export interface AiTextProvider {
  id: AiProviderId;
  createChatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult>;
  streamChatCompletion?(input: ChatCompletionInput): AsyncIterable<ChatDelta>;
}
