import type { AiProviderId, ChatCompletionInput, ChatCompletionResult, ChatDelta } from "../ai-provider.interface.js";

type OpenAiCompatibleContent = string | Array<{ type?: string; text?: string }> | undefined;

interface OpenAiCompatibleChoice {
  message?: {
    content?: OpenAiCompatibleContent;
  };
}

interface OpenAiCompatibleResponse {
  choices?: OpenAiCompatibleChoice[];
}

interface OpenAiCompatibleStreamChoice {
  delta?: {
    content?: OpenAiCompatibleContent;
  };
}

interface OpenAiCompatibleStreamChunk {
  choices?: OpenAiCompatibleStreamChoice[];
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
    throw new Error(`${input.providerId.toUpperCase()}_API_KEY is not configured.`);
  }

  const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      ...input.headers
    },
    body: JSON.stringify({
      model: input.completion.model,
      ...input.extraBody,
      messages: input.completion.messages,
      temperature: input.completion.temperature,
      max_tokens: input.completion.maxTokens
    })
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`${input.providerId} chat completion failed: ${detail}`);
  }

  const payload = (await response.json()) as OpenAiCompatibleResponse;
  const text = normalizeContent(payload.choices?.[0]?.message?.content);
  if (!text) throw new Error(`${input.providerId} chat completion returned an empty response.`);

  return {
    providerId: input.providerId,
    model: input.completion.model,
    text
  };
}

export async function* streamOpenAiCompatibleChatCompletion(input: OpenAiCompatibleRequestInput): AsyncIterable<ChatDelta> {
  const response = await requestChatCompletion(input, { stream: true });

  if (!response.body) {
    throw new Error(`${input.providerId} chat completion returned an empty stream.`);
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
      const text = normalizeDeltaContent(payload?.choices?.[0]?.delta?.content);
      if (text) yield { text };
    }
  }

  buffer += decoder.decode();
  const event = parseSseLine(buffer);
  if (event && event !== "[DONE]") {
    const payload = parseStreamChunk(event);
    const text = normalizeDeltaContent(payload?.choices?.[0]?.delta?.content);
    if (text) yield { text };
  }
}

async function requestChatCompletion(input: OpenAiCompatibleRequestInput, extraBody?: Record<string, unknown>) {
  if (!input.apiKey) {
    throw new Error(`${input.providerId.toUpperCase()}_API_KEY is not configured.`);
  }

  const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      ...input.headers
    },
    body: JSON.stringify({
      model: input.completion.model,
      ...input.extraBody,
      messages: input.completion.messages,
      temperature: input.completion.temperature,
      max_tokens: input.completion.maxTokens,
      ...extraBody
    })
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`${input.providerId} chat completion failed: ${detail}`);
  }

  return response;
}

async function readErrorDetail(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function normalizeContent(content: OpenAiCompatibleContent) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
    .join("")
    .trim();
}

function normalizeDeltaContent(content: OpenAiCompatibleContent) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => (part.type === "text" || !part.type ? part.text ?? "" : "")).join("");
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
