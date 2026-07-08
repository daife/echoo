import type { AiProviderId, ChatCompletionInput, ChatCompletionResult } from "../ai-provider.interface.js";

type OpenAiCompatibleContent = string | Array<{ type?: string; text?: string }> | undefined;

interface OpenAiCompatibleChoice {
  message?: {
    content?: OpenAiCompatibleContent;
  };
}

interface OpenAiCompatibleResponse {
  choices?: OpenAiCompatibleChoice[];
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
    text,
    raw: payload
  };
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
