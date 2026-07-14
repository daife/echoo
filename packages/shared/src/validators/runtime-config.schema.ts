import { z } from "zod";

const optionalText = z.string().trim().max(2048).optional();
const optionalPositive = z.number().finite().positive().optional();
const optionalNonnegative = z.number().finite().nonnegative().optional();

const modelEndpointPatchSchema = z.object({
  provider: optionalText,
  routingProvider: optionalText.nullable(),
  baseUrl: optionalText,
  model: optionalText,
  apiKey: z.string().max(8192).nullable().optional(),
});

const textModelPatchSchema = modelEndpointPatchSchema.extend({
  temperature: z.number().finite().optional(),
  maxTokens: optionalPositive,
});

const fishAudioPatchSchema = z.object({
  provider: optionalText,
  apiKey: z.string().max(8192).nullable().optional(),
  referenceId: optionalText,
  model: optionalText,
  httpUrl: optionalText,
  wsUrl: optionalText,
  latency: optionalText,
  chunkLength: optionalPositive,
});

export const sliceFigureRuntimeConfigPatchSchema = z.object({
  llm: textModelPatchSchema.optional(),
  context: z
    .object({
      minimumRounds: optionalPositive,
      maximumRounds: optionalPositive,
      memorySummaryRounds: optionalPositive,
    })
    .optional(),
});

export const primeFigureRuntimeConfigPatchSchema = z.object({
  llm: textModelPatchSchema.optional(),
  image: modelEndpointPatchSchema.optional(),
  tts: fishAudioPatchSchema.optional(),
  context: z
    .object({
      minimumMessages: optionalPositive,
      maximumMessages: optionalPositive,
    })
    .optional(),
  typingCharsPerMinute: optionalPositive,
  messageCoalesceMs: optionalNonnegative,
});

export const userRuntimeConfigPatchSchema = z.object({
  sliceFigure: sliceFigureRuntimeConfigPatchSchema.optional(),
  primeFigure: primeFigureRuntimeConfigPatchSchema.optional(),
  primeWorld: z.object({}).optional(),
});

export const conversationRuntimeConfigPatchSchema = z.object({
  mode: z.enum(["global", "custom"]),
  config: z.unknown().optional(),
});
