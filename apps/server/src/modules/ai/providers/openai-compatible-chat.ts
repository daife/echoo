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

  const response = await requestChatCompletion(input);

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

  let response = await sendChatCompletionRequest(input, extraBody);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (shouldRetryWithJsonObject(input, detail)) {
      response = await sendChatCompletionRequest(input, extraBody, {
        forceJsonObject: true,
      });
      if (response.ok) return response;

      const fallbackDetail = await readErrorDetail(response);
      throw new Error(
        `${input.providerId} chat completion failed: ${fallbackDetail}`,
      );
    }
    throw new Error(`${input.providerId} chat completion failed: ${detail}`);
  }

  return response;
}

function sendChatCompletionRequest(
  input: OpenAiCompatibleRequestInput,
  extraBody?: Record<string, unknown>,
  options?: { forceJsonObject?: boolean },
) {
  const body = {
    ...buildOpenAiCompatibleRequestBody(input, options),
    ...extraBody,
    ...(extraBody?.stream === true && isDeepSeekApiUrl(input.baseUrl)
      ? { stream_options: { include_usage: true } }
      : {}),
  };
  return fetch(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      ...input.headers,
    },
    body: JSON.stringify(body),
  });
}

export function buildOpenAiCompatibleRequestBody(
  input: OpenAiCompatibleRequestInput,
  options?: { forceJsonObject?: boolean },
): Record<string, unknown> {
  const originalResponseFormat = input.completion.responseFormat;
  const downgradeToJsonObject =
    isJsonSchemaResponseFormat(originalResponseFormat) &&
    (isDeepSeekApiUrl(input.baseUrl) || options?.forceJsonObject === true);
  const useJsonObject =
    downgradeToJsonObject || isJsonObjectResponseFormat(originalResponseFormat);

  return {
    model: input.completion.model,
    ...input.extraBody,
    messages: (useJsonObject
      ? withJsonObjectInstruction(
          input.completion.messages,
          originalResponseFormat!,
        )
      : input.completion.messages
    ).map(toOpenAiMessage),
    temperature: input.completion.temperature,
    max_tokens: input.completion.maxTokens,
    response_format: downgradeToJsonObject
      ? { type: "json_object" }
      : originalResponseFormat,
    tools: input.completion.tools,
    tool_choice: input.completion.toolChoice,
    parallel_tool_calls: input.completion.tools?.length ? false : undefined,
    ...(input.completion.reasoningMode === "disabled"
      ? disabledReasoningConfig(input.baseUrl)
      : {}),
  };
}

function isJsonSchemaResponseFormat(responseFormat?: Record<string, unknown>) {
  return responseFormat?.type === "json_schema";
}

function isJsonObjectResponseFormat(responseFormat?: Record<string, unknown>) {
  return responseFormat?.type === "json_object";
}

function withJsonObjectInstruction(
  messages: ChatCompletionMessage[],
  responseFormat: Record<string, unknown>,
) {
  const schemaContainer = responseFormat.json_schema;
  const schema =
    schemaContainer && typeof schemaContainer === "object"
      ? (schemaContainer as Record<string, unknown>).schema
      : undefined;
  const instruction = [
    "你必须只输出一个合法的 JSON 对象，不要输出 Markdown 代码块或任何额外文本。",
    ...(schema
      ? [
          "输出必须遵循以下 JSON Schema；生成完成后，应用还会再次校验该结构：",
          JSON.stringify(schema),
        ]
      : []),
  ].join("\n");
  const systemIndex = messages.findIndex(
    (message) => message.role === "system",
  );

  if (systemIndex < 0) {
    return [{ role: "system" as const, content: instruction }, ...messages];
  }

  return messages.map((message, index) => {
    if (index !== systemIndex) return message;
    return {
      ...message,
      content:
        typeof message.content === "string"
          ? `${message.content}\n\n${instruction}`
          : [...message.content, { type: "text" as const, text: instruction }],
    };
  });
}

function shouldRetryWithJsonObject(
  input: OpenAiCompatibleRequestInput,
  detail: string,
) {
  if (
    input.providerId !== "openrouter" ||
    isDeepSeekApiUrl(input.baseUrl) ||
    !isJsonSchemaResponseFormat(input.completion.responseFormat)
  )
    return false;

  const normalized = detail.toLowerCase();
  return (
    /response[_ -]?format type is (?:currently )?(?:unavailable|unsupported|not supported)/.test(
      normalized,
    ) ||
    /(?:response[_ -]?format|json[_ -]?schema|structured outputs?).*(?:unavailable|unsupported|not supported|not available)/.test(
      normalized,
    ) ||
    /(?:model|provider|route|endpoint).*(?:does not support|doesn't support|unsupported).*(?:response[_ -]?format|json[_ -]?schema|structured outputs?)/.test(
      normalized,
    ) ||
    /no endpoints? found.*support.*requested parameters?/.test(normalized)
  );
}

function disabledReasoningConfig(baseUrl: string) {
  if (isDeepSeekApiUrl(baseUrl)) {
    // DeepSeek's OpenAI-compatible API does not accept `reasoning_effort:
    // "none"`; it uses its provider-specific thinking switch instead.
    return { thinking: { type: "disabled" } };
  }

  // OpenRouter's unified reasoning configuration is the current supported
  // way to disable reasoning. `exclude` also prevents a reasoning trace from
  // being returned should an upstream provider emit one.
  return { reasoning: { effort: "none", exclude: true } };
}

function isDeepSeekApiUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
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
