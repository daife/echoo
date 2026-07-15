import type {
  AiProviderId,
  ChatCompletionInput,
  ChatCompletionMessage,
  ChatCompletionResult,
  ChatDelta,
  ChatToolCall,
} from "../ai-provider.interface.js";

type OpenAiCompatibleContent =
  string | Array<{ type?: string; text?: string }> | undefined;

interface OpenAiCompatibleChoice {
  message?: {
    content?: OpenAiCompatibleContent;
    tool_calls?: ChatToolCall[];
  };
}

interface OpenAiCompatibleResponse {
  id?: string;
  choices?: OpenAiCompatibleChoice[];
  usage?: OpenAiCompatibleUsage;
}

interface OpenAiCompatibleUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface OpenAiCompatibleStreamChoice {
  delta?: {
    content?: OpenAiCompatibleContent;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }>;
  };
}

interface OpenAiCompatibleStreamChunk {
  id?: string;
  choices?: OpenAiCompatibleStreamChoice[];
  usage?: OpenAiCompatibleUsage;
}

interface OpenAiCompatibleRequestInput {
  providerId: AiProviderId;
  apiKey?: string;
  baseUrl: string;
  completion: ChatCompletionInput;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export async function createOpenAiCompatibleChatCompletion(input: {
  providerId: AiProviderId;
  apiKey?: string;
  baseUrl: string;
  completion: ChatCompletionInput;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}): Promise<ChatCompletionResult> {
  if (!input.apiKey) {
    throw new Error(`${input.providerId} API key is not configured.`);
  }

  const response = await fetch(
    `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        ...input.headers,
      },
      body: JSON.stringify(buildRequestBody(input)),
    },
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`${input.providerId} chat completion failed: ${detail}`);
  }

  const payload = (await response.json()) as OpenAiCompatibleResponse;
  const text = normalizeContent(payload.choices?.[0]?.message?.content);
  const toolCalls = payload.choices?.[0]?.message?.tool_calls;
  if (!text && !toolCalls?.length)
    throw new Error(
      `${input.providerId} chat completion returned an empty response.`,
    );

  return {
    providerId: input.providerId,
    model: input.completion.model,
    text,
    ...(toolCalls?.length ? { toolCalls } : {}),
    ...(payload.id || payload.usage
      ? { usage: normalizeUsage(payload.id, payload.usage) }
      : {}),
  };
}

export async function* streamOpenAiCompatibleChatCompletion(
  input: OpenAiCompatibleRequestInput,
): AsyncIterable<ChatDelta> {
  const response = await requestChatCompletion(input, { stream: true });

  if (!response.body) {
    throw new Error(
      `${input.providerId} chat completion returned an empty stream.`,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSseLine(line);
      if (!event) continue;
      if (event === "[DONE]") return;

      const payload = parseStreamChunk(event);
      const delta = payload?.choices?.[0]?.delta;
      const text = normalizeDeltaContent(delta?.content);
      if (text || delta?.tool_calls?.length || payload?.usage)
        yield {
          ...(text ? { text } : {}),
          ...(delta?.tool_calls?.length ? { toolCalls: delta.tool_calls } : {}),
          ...(payload?.id || payload?.usage
            ? { usage: normalizeUsage(payload.id, payload.usage) }
            : {}),
        };
    }
  }

  buffer += decoder.decode();
  const event = parseSseLine(buffer);
  if (event && event !== "[DONE]") {
    const payload = parseStreamChunk(event);
    const delta = payload?.choices?.[0]?.delta;
    const text = normalizeDeltaContent(delta?.content);
    if (text || delta?.tool_calls?.length || payload?.usage)
      yield {
        ...(text ? { text } : {}),
        ...(delta?.tool_calls?.length ? { toolCalls: delta.tool_calls } : {}),
        ...(payload?.id || payload?.usage
          ? { usage: normalizeUsage(payload.id, payload.usage) }
          : {}),
      };
  }
}

async function requestChatCompletion(
  input: OpenAiCompatibleRequestInput,
  extraBody?: Record<string, unknown>,
) {
  if (!input.apiKey) {
    throw new Error(`${input.providerId} API key is not configured.`);
  }

  const response = await fetch(
    `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        ...input.headers,
      },
      body: JSON.stringify({
        ...buildRequestBody(input),
        ...extraBody,
      }),
    },
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`${input.providerId} chat completion failed: ${detail}`);
  }

  return response;
}

function buildRequestBody(input: OpenAiCompatibleRequestInput) {
  return {
    model: input.completion.model,
    ...input.extraBody,
    messages: input.completion.messages.map(toOpenAiMessage),
    temperature: input.completion.temperature,
    max_tokens: input.completion.maxTokens,
    response_format: input.completion.responseFormat,
    tools: input.completion.tools,
    tool_choice: input.completion.toolChoice,
    parallel_tool_calls: input.completion.tools?.length ? false : undefined,
    ...(input.completion.reasoningMode === "disabled"
      ? {
          reasoning: { enabled: false, exclude: true },
          reasoning_effort: "none",
        }
      : {}),
  };
}

function toOpenAiMessage(message: ChatCompletionMessage) {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length ? { tool_calls: message.toolCalls } : {}),
  };
}

async function readErrorDetail(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message ?? payload.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function normalizeContent(content: OpenAiCompatibleContent) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) =>
      part.type === "text" || !part.type ? (part.text ?? "") : "",
    )
    .join("")
    .trim();
}

function normalizeDeltaContent(content: OpenAiCompatibleContent) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) =>
      part.type === "text" || !part.type ? (part.text ?? "") : "",
    )
    .join("");
}

function parseSseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data:")) return null;
  return trimmed.slice("data:".length).trim();
}

function parseStreamChunk(event: string) {
  try {
    return JSON.parse(event) as OpenAiCompatibleStreamChunk;
  } catch {
    return null;
  }
}

function normalizeUsage(id?: string, usage?: OpenAiCompatibleUsage) {
  return {
    ...(id ? { upstreamRequestId: id } : {}),
    ...(typeof usage?.prompt_tokens === "number"
      ? { promptTokens: usage.prompt_tokens }
      : {}),
    ...(typeof usage?.completion_tokens === "number"
      ? { completionTokens: usage.completion_tokens }
      : {}),
    ...(typeof usage?.total_tokens === "number"
      ? { totalTokens: usage.total_tokens }
      : {}),
    ...(typeof usage?.cost === "number" ? { costUsd: usage.cost } : {}),
  };
}
