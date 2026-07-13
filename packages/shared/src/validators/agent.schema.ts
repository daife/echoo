import { z } from "zod";

const requiredText = (label: string, max = 2000) =>
  z.string().trim().min(1, `${label}不能为空。`).max(max);
const optionalText = (max = 2000) =>
  z.string().trim().max(max).optional().default("");
const generationPromptSchema = requiredText("生图提示词", 12000);

const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  dataBase64: z.string().min(1),
});

const primeFigureReferenceImageInputSchema = z.union([
  z
    .object({
      resourceId: z.string().trim().min(1).max(120),
      description: requiredText("图片描述", 4000),
    })
    .strict(),
  z
    .object({
      upload: imageUploadSchema,
      description: requiredText("图片描述", 4000),
    })
    .strict(),
]);

export const agentAttributeSchema = z.object({
  key: requiredText("属性键", 80),
  value: requiredText("属性值", 240),
});

const createAgentBaseSchema = z.object({
  avatar: imageUploadSchema.nullish(),
  cover: imageUploadSchema.nullish(),
  name: requiredText("角色名称", 80),
  attributes: z.array(agentAttributeSchema).max(50).optional().default([]),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(30)
    .optional()
    .default([]),
  introduction: optionalText(2000),
  isPublic: z.boolean(),
});

export const createSliceFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("slice-figure"),
  prologueHtml: optionalText(12000),
  currentSituation: optionalText(4000),
  openingLine: optionalText(2000),
  linkedAgentIds: z
    .array(z.string().trim().min(1).max(120))
    .max(50)
    .optional()
    .default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("人设"),
  background: requiredText("背景"),
  personality: requiredText("性格"),
  responseStyle: requiredText("回复风格"),
  systemPrompt: requiredText("系统提示词", 12000),
  memorySummaryPrompt: requiredText("记忆总结提示词", 12000),
  replyAutoSegment: z.boolean().optional().default(false),
});

const primeVariableValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const primeFigureVariableDefinitionSchema = z
  .object({
    key: requiredText("变量键", 80).regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "变量键必须符合 JSON Schema 的安全命名规则。",
    ),
    label: requiredText("变量标签", 120),
    type: z.enum(["string", "number", "boolean", "json"]),
    description: requiredText("变量描述", 1000),
    defaultValue: primeVariableValueSchema.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .superRefine((definition, context) => {
    if (
      definition.type !== "number" &&
      (definition.min !== undefined || definition.max !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "只有数字变量可以定义最小值或最大值。",
      });
    }
    if (
      definition.min !== undefined &&
      definition.max !== undefined &&
      definition.min > definition.max
    ) {
      context.addIssue({
        code: "custom",
        message: "变量最小值不能大于最大值。",
      });
    }
    if (definition.defaultValue === undefined) return;
    const matches =
      (definition.type === "string" &&
        typeof definition.defaultValue === "string") ||
      (definition.type === "number" &&
        typeof definition.defaultValue === "number") ||
      (definition.type === "boolean" &&
        typeof definition.defaultValue === "boolean") ||
      (definition.type === "json" &&
        (definition.defaultValue === null ||
          typeof definition.defaultValue === "object"));
    if (!matches)
      context.addIssue({
        code: "custom",
        message: `默认值与 ${definition.type} 类型不匹配。`,
      });
  });

export const primeFigureMemorySchema = z.object({
  id: z.string().trim().min(1).max(120),
  content: requiredText("记忆", 4000),
  eventAtMs: z.number().nonnegative(),
  recordedAtMs: z.number().nonnegative(),
});

const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须采用 HH:mm 格式。");

export const primeFigureScheduleSchema = z.object({
  segments: z
    .array(
      z.object({
        label: requiredText("日程时段名称", 120),
        days: z
          .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
          .min(1)
          .max(7),
        start: clockTimeSchema,
        end: clockTimeSchema,
        description: requiredText("日程时段描述", 1000),
      }),
    )
    .max(100),
});

export const primeFigureStateSchema = z.object({
  variables: z
    .record(z.string(), primeVariableValueSchema)
    .optional()
    .default({}),
  memories: z.array(primeFigureMemorySchema).max(1000).optional().default([]),
  mood: optionalText(500),
  moodObservedAtMs: z.number().nonnegative(),
  relationshipStatus: optionalText(500),
  silenceStartedAtMs: z.number().nonnegative().optional(),
  silenceUntilMs: z.number().nonnegative().optional(),
  updatedAt: z.number().nonnegative(),
});

export const createPrimeFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-figure"),
  prologueHtml: optionalText(12000),
  linkedAgentIds: z
    .array(z.string().trim().min(1).max(120))
    .max(50)
    .optional()
    .default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("人设"),
  background: requiredText("背景"),
  personality: requiredText("性格"),
  responseStyle: requiredText("回复风格"),
  decisionStyle: optionalText(4000),
  currentSituation: optionalText(4000),
  schedule: primeFigureScheduleSchema.optional().default({ segments: [] }),
  itinerary: optionalText(8000),
  variableDefinitions: z
    .array(primeFigureVariableDefinitionSchema)
    .max(100)
    .superRefine((definitions, context) => {
      const keys = new Set<string>();
      definitions.forEach((definition, index) => {
        if (keys.has(definition.key))
          context.addIssue({
            code: "custom",
            path: [index, "key"],
            message: "变量键不能重复。",
          });
        keys.add(definition.key);
      });
    })
    .optional()
    .default([]),
  referenceImages: z
    .array(primeFigureReferenceImageInputSchema)
    .max(10)
    .optional()
    .default([]),
  voiceRequestStreaming: z.boolean().optional().default(false),
  initialMood: optionalText(500),
  initialRelationshipStatus: optionalText(500),
});

export const updatePrimeFigureSchema = createPrimeFigureSchema
  .omit({
    type: true,
    initialMood: true,
    initialRelationshipStatus: true,
    referenceImages: true,
  })
  .extend({
    referenceImages: z
      .array(primeFigureReferenceImageInputSchema)
      .max(10)
      .optional(),
    currentVariables: z.record(z.string(), primeVariableValueSchema),
    currentMood: z.string().trim().max(500),
    currentRelationshipStatus: z.string().trim().max(500),
    // Preserve the stored preference when older clients omit this field.
    voiceRequestStreaming: z.boolean().optional(),
  });

export const updatePrimeFigurePreferencesSchema = z.object({
  voiceRequestStreaming: z.boolean(),
});

const urlLikeSchema = z.string().trim().min(1).max(2048);

const primeImageContentSchema = z
  .object({
    type: z.literal("image"),
    description: z.string().trim().min(1).max(4000).optional(),
    generationPrompt: optionalText(12000),
    referenceResourceUrls: z
      .array(urlLikeSchema)
      .max(20)
      .optional()
      .default([]),
    referenceMediaIds: z
      .array(z.string().regex(/^media_[1-9]\d*$/))
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, "参考图片 ID 不得重复")
      .optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  })
  .refine((content) => Boolean(content.description || content.resourceId), {
    message: "图片必须包含描述或资源 ID。",
  });

const primeVideoContentSchema = z
  .object({
    type: z.literal("video"),
    description: z.string().trim().min(1).max(4000).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  })
  .refine((content) => Boolean(content.description || content.resourceId), {
    message: "视频必须包含描述或资源 ID。",
  });

const primeVoiceContentSchema = z
  .object({
    type: z.literal("voice"),
    description: z.string().trim().min(1).max(4000).optional(),
    transcript: z.string().trim().min(1).max(12000).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  })
  .refine((content) => Boolean(content.transcript || content.resourceId), {
    message: "语音必须包含转写或资源 ID。",
  });

export const primeMessageContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: requiredText("文本", 12000),
  }),
  primeImageContentSchema,
  primeVideoContentSchema,
  primeVoiceContentSchema,
  z.object({
    type: z.literal("sticker"),
    stickerId: requiredText("贴纸 ID", 120),
    description: requiredText("贴纸描述", 1000),
    resourceUrl: urlLikeSchema.optional(),
  }),
  z.object({
    type: z.literal("transfer"),
    note: optionalText(500),
    amount: z.number().finite().nonnegative(),
    currency: z.string().trim().min(1).max(16).default("CNY"),
    direction: z.enum(["received", "paid"]),
  }),
]);

export const primeMediaAnnotationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(["image", "video"]),
    description: requiredText("媒体描述", 4000),
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("voice"),
    transcript: requiredText("语音转写", 12000),
  }),
]);

export const primeMessageSchema = z.object({
  id: z.string().trim().min(1).max(120),
  ownerUserId: z.string().trim().min(1).max(120),
  agentId: z.string().trim().min(1).max(120),
  conversationId: z.string().trim().min(1).max(120),
  sender: z.enum(["prime_figure", "end_user"]),
  messageType: z.enum([
    "text",
    "image",
    "video",
    "voice",
    "sticker",
    "transfer",
  ]),
  content: primeMessageContentSchema,
  occurredAtMs: z.number().nonnegative(),
  occurredAtIso: z.string().trim().min(1).max(80),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
});

const primeFigureActionOutputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_message"),
    message: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("text"),
        text: requiredText("文本", 12000),
      }),
      z.object({
        type: z.literal("image"),
        description: optionalText(4000),
        generationPrompt: generationPromptSchema,
        referenceMediaIds: z
          .array(z.string().regex(/^media_[1-9]\d*$/))
          .max(10)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "参考图片 ID 不得重复",
          )
          .optional()
          .default([]),
      }),
      z.object({
        type: z.literal("voice"),
        transcript: requiredText("语音文本", 12000),
      }),
    ]),
  }),
  z
    .object({
      type: z.literal("silence"),
    })
    .strict(),
  z
    .object({
      type: z.literal("mute"),
      revisitAfterMinutes: z.number().int().min(1).max(10080),
    })
    .strict(),
]);

export const primeFigureActionSchema = z.preprocess(
  normalizePrimeFigureAction,
  primeFigureActionOutputSchema,
);

function normalizePrimeFigureAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const action = value as Record<string, unknown>;
  const message =
    action.message &&
    typeof action.message === "object" &&
    !Array.isArray(action.message)
      ? (action.message as Record<string, unknown>)
      : null;
  if (!message || !isPrimeOutgoingMessageType(message.type)) return value;

  const normalizedMessage = { ...message };
  if (message.type === "image") {
    if (!("description" in normalizedMessage))
      normalizedMessage.description = "";
    normalizedMessage.referenceMediaIds = normalizeReferenceMediaIds(
      normalizedMessage.referenceMediaIds,
    );
  }

  if (
    action.type === "send_message" ||
    action.type === "silence" ||
    action.type === "mute"
  )
    return { ...action, message: normalizedMessage };
  return { ...action, type: "send_message", message: normalizedMessage };
}

function isPrimeOutgoingMessageType(value: unknown) {
  return value === "text" || value === "image" || value === "voice";
}

function normalizeReferenceMediaIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && /^media_[1-9]\d*$/.test(item),
      ),
    ),
  ].slice(0, 10);
}

export const primeFigureDecisionSchema = z.object({
  rationale: requiredText("角色决策依据", 2000),
  figureMood: requiredText("角色情绪", 500),
  variables: z.record(z.string(), primeVariableValueSchema),
  memoryWrites: z
    .array(
      z.object({
        content: requiredText("记忆", 4000),
        eventAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .nullable(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  stateUpdates: z
    .object({
      currentSituation: z.string().trim().max(4000).nullish(),
      schedule: primeFigureScheduleSchema.nullish(),
      itinerary: z.string().trim().max(8000).nullish(),
      relationshipStatus: z.string().trim().max(500).nullish(),
    })
    .optional()
    .default({}),
  actions: z
    .array(primeFigureActionSchema)
    .min(1)
    .max(12)
    .superRefine((actions, context) => {
      const containsExclusiveAction = actions.some(
        (action) => action.type === "silence" || action.type === "mute",
      );
      if (containsExclusiveAction && actions.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "silence 或 mute 必须是一次决定中的唯一动作。",
        });
      }
    }),
});

export const updateSliceFigureSchema = createSliceFigureSchema.omit({
  type: true,
});

export const createPrimeWorldPlaceholderSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-world"),
});
