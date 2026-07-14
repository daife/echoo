import type { PrimeFigureDecision } from "@echoo/shared";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import type { ChatCompletionInput } from "../../../ai/ai-provider.interface.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import {
  buildImageOptimizationSystemPrompt,
  buildVoiceOptimizationSystemPrompt,
} from "./prime-prompt-composer.js";

export interface PrimeOptimizationHooks {
  onVoiceStart?: (actionIndex: number) => void;
  onVoiceDelta?: (actionIndex: number, delta: string) => void;
  onVoiceComplete?: (actionIndex: number, transcript: string) => void;
  onVoiceFallback?: (actionIndex: number, transcript: string) => void;
  onFailure?: (input: {
    kind: "image" | "voice";
    actionIndex: number;
    error: string;
  }) => void;
}

export class PrimeContentOptimizer {
  constructor(private readonly providers = new AiProviderRegistry()) {}

  async optimizeDecision(
    decision: PrimeFigureDecision,
    config: StoredPrimeFigureRuntimeConfig,
    hooks: PrimeOptimizationHooks = {},
  ): Promise<PrimeFigureDecision> {
    const actions = await Promise.all(
      decision.actions.map(async (action, actionIndex) => {
        if (action.type !== "send_message") return action;
        if (
          action.message.type === "image" &&
          config.optimization.image.enabled
        ) {
          try {
            const generationPrompt = await this.optimizeField({
              field: "generationPrompt",
              value: action.message.generationPrompt,
              systemPrompt: buildImageOptimizationSystemPrompt(
                config.optimization.image.level,
              ),
              config: config.optimization.image.model,
              context: { description: action.message.description },
            });
            return {
              ...action,
              message: { ...action.message, generationPrompt },
            };
          } catch (error) {
            hooks.onFailure?.({
              kind: "image",
              actionIndex,
              error: errorMessage(error),
            });
            return action;
          }
        }
        if (
          action.message.type === "voice" &&
          config.optimization.voice.enabled
        ) {
          try {
            hooks.onVoiceStart?.(actionIndex);
            const transcript = await this.optimizeVoice(
              action.message.transcript,
              config,
              (delta) => hooks.onVoiceDelta?.(actionIndex, delta),
            );
            hooks.onVoiceComplete?.(actionIndex, transcript);
            return { ...action, message: { ...action.message, transcript } };
          } catch (error) {
            hooks.onFailure?.({
              kind: "voice",
              actionIndex,
              error: errorMessage(error),
            });
            hooks.onVoiceFallback?.(actionIndex, action.message.transcript);
            return action;
          }
        }
        return action;
      }),
    );
    return { ...decision, actions: actions as PrimeFigureDecision["actions"] };
  }

  private async optimizeVoice(
    transcript: string,
    config: StoredPrimeFigureRuntimeConfig,
    onDelta: (delta: string) => void,
  ) {
    const modelConfig = config.optimization.voice.model;
    const provider = this.providers.createProvider(modelConfig);
    const completion = singleFieldCompletion(
      modelConfig,
      "transcript",
      buildVoiceOptimizationSystemPrompt(config.optimization.voice.level),
      transcript,
    );
    if (!provider.streamChatCompletion) {
      const result = await provider.createChatCompletion(completion);
      const value = parseSingleField(result.text, "transcript");
      onDelta(value);
      return value;
    }
    let raw = "";
    let emitted = "";
    for await (const event of provider.streamChatCompletion(completion)) {
      raw += event.text ?? "";
      const partial = decodeJsonStringFieldPrefix(raw, "transcript");
      if (partial.startsWith(emitted)) {
        const delta = partial.slice(emitted.length);
        if (delta) onDelta(delta);
        emitted = partial;
      }
    }
    const value = parseSingleField(raw, "transcript");
    if (value.startsWith(emitted) && value.length > emitted.length)
      onDelta(value.slice(emitted.length));
    return value;
  }

  private async optimizeField(input: {
    field: "generationPrompt";
    value: string;
    systemPrompt: string;
    config: StoredPrimeFigureRuntimeConfig["optimization"]["image"]["model"];
    context: Record<string, unknown>;
  }) {
    const provider = this.providers.createProvider(input.config);
    const result = await provider.createChatCompletion(
      singleFieldCompletion(
        input.config,
        input.field,
        input.systemPrompt,
        input.value,
        input.context,
      ),
    );
    return parseSingleField(result.text, input.field);
  }
}

function singleFieldCompletion(
  config: StoredPrimeFigureRuntimeConfig["decisionModel"],
  field: "transcript" | "generationPrompt",
  systemPrompt: string,
  value: string,
  context: Record<string, unknown> = {},
): ChatCompletionInput {
  return {
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    reasoningMode: "disabled",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({ draft: value, ...context }),
      },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: `prime_${field}_optimization`,
        strict: true,
        schema: {
          type: "object",
          properties: { [field]: { type: "string", minLength: 1 } },
          required: [field],
          additionalProperties: false,
        },
      },
    },
  };
}

function parseSingleField(
  raw: string,
  field: "transcript" | "generationPrompt",
) {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const value = parsed[field];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`优化模型未返回有效的 ${field}。`);
  return value;
}

function decodeJsonStringFieldPrefix(raw: string, field: string) {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  let encoded = "";
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index] as string;
    if (character === '"') break;
    if (character !== "\\") {
      encoded += character;
      continue;
    }
    const escape = raw[index + 1];
    if (!escape) break;
    if (escape === "u") {
      const unicode = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(unicode)) break;
      encoded += `\\u${unicode}`;
      index += 5;
      continue;
    }
    encoded += `\\${escape}`;
    index += 1;
  }
  try {
    return JSON.parse(`"${encoded}"`) as string;
  } catch {
    return "";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "额外优化失败。";
}
