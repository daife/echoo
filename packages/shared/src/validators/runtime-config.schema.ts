import { z } from "zod";

const optionalText = z.string().trim().max(2048).optional();
const optionalPositive = z.number().finite().positive().optional();
const optionalNonnegative = z.number().finite().nonnegative().optional();
const imageParametersSchema = z
  .record(z.string().max(120), z.unknown())
  .refine((value) => {
    try {
      return JSON.stringify(value).length <= 16_384;
    } catch {
      return false;
    }
  }, "生图参数必须是小于 16KB 的 JSON 对象。");

const modelEndpointPatchSchema = z.object({
  source: z.enum(["platform", "custom"]).optional(),
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
  source: z.enum(["platform", "custom"]).optional(),
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
  decisionModel: textModelPatchSchema.optional(),
  outputs: z
    .object({
      image: z
        .object({
          enabled: z.boolean().optional(),
          guidanceLevel: z.enum(["basic", "medium", "advanced"]).optional(),
          generator: modelEndpointPatchSchema.optional(),
          parameters: imageParametersSchema.optional(),
        })
        .optional(),
      voice: z
        .object({
          enabled: z.boolean().optional(),
          guidanceLevel: z.enum(["basic", "medium", "advanced"]).optional(),
          tts: fishAudioPatchSchema.optional(),
        })
        .optional(),
      sticker: z
        .object({
          enabled: z.boolean().optional(),
        })
        .optional(),
      transfer: z
        .object({
          enabled: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  optimization: z
    .object({
      image: z
        .object({
          enabled: z.boolean().optional(),
          level: z.enum(["advanced", "top"]).optional(),
          model: textModelPatchSchema.optional(),
        })
        .optional(),
      voice: z
        .object({
          enabled: z.boolean().optional(),
          level: z.enum(["advanced", "top"]).optional(),
          model: textModelPatchSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  understanding: z
    .object({
      visual: z
        .object({
          mode: z.enum(["native", "auxiliary"]).optional(),
          model: textModelPatchSchema.optional(),
        })
        .optional(),
      audio: z
        .object({
          mode: z.enum(["native", "auxiliary"]).optional(),
          model: textModelPatchSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  context: z
    .object({
      minimumMessages: optionalPositive,
      maximumMessages: optionalPositive,
    })
    .optional(),
  typingCharsPerMinute: optionalPositive,
  messageCoalesceMs: optionalNonnegative,
  wakeups: z
    .object({
      proactive: z
        .object({
          enabled: z.boolean().optional(),
          interactionInvalidationWindowMinutes: z
            .number()
            .int()
            .nonnegative()
            .optional(),
        })
        .optional(),
      passive: z
        .object({
          enabled: z.boolean().optional(),
          milestonesMinutes: z
            .tuple([
              z.number().int().positive(),
              z.number().int().positive(),
              z.number().int().positive(),
            ])
            .refine(
              ([first, second, third]) => first < second && second < third,
              "被动唤醒时间必须严格递增。",
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
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
