import { z } from "zod";

const requiredText = (label: string, max = 2000) =>
  z.string().trim().min(1, `${label}不能为空。`).max(max);
const optionalText = (max = 2000) =>
  z.string().trim().max(max).optional().default("");

const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  dataBase64: z.string().min(1),
});

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
  timezone: requiredText("日程时区", 80).refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "日程时区必须是有效的 IANA 时区。"),
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
  schedule: primeFigureScheduleSchema
    .optional()
    .default({ timezone: "UTC", segments: [] }),
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
  initialMood: optionalText(500),
  initialRelationshipStatus: optionalText(500),
});

export const updatePrimeFigureSchema = createPrimeFigureSchema.omit({
  type: true,
  avatar: true,
  cover: true,
  initialMood: true,
  initialRelationshipStatus: true,
});

const urlLikeSchema = z.string().trim().min(1).max(2048);

export const primeMessageContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: requiredText("文本", 12000),
  }),
  z.object({
    type: z.literal("image"),
    description: requiredText("图片描述", 4000),
    generationPrompt: optionalText(4000),
    referenceResourceUrls: z
      .array(urlLikeSchema)
      .max(20)
      .optional()
      .default([]),
    resourceUrl: urlLikeSchema.optional(),
  }),
  z.object({
    type: z.literal("video"),
    description: requiredText("视频描述", 4000),
    resourceUrl: urlLikeSchema,
  }),
  z.object({
    type: z.literal("voice"),
    description: requiredText("语音描述", 4000),
    transcript: requiredText("语音转写", 12000),
    resourceUrl: urlLikeSchema.optional(),
  }),
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

export const primeMessageSchema = z.object({
  id: z.string().trim().min(1).max(120),
  ownerUserId: z.string().trim().min(1).max(120),
  agentId: z.string().trim().min(1).max(120),
  conversationId: z.string().trim().min(1).max(120),
  sender: z.enum(["prime_figure", "end_user", "system"]),
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
  timezone: z.string().trim().min(1).max(80),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
});

export const primeFigureActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_message"),
    message: z.object({
      type: z.literal("text"),
      text: requiredText("文本", 12000),
    }),
  }),
  z.object({
    type: z.literal("silence"),
    revisitAfterMinutes: z.number().int().min(1).max(10080),
  }),
]);

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
      const containsSilence = actions.some((action) => action.type === "silence");
      if (containsSilence && actions.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "silence 必须是一次决定中的唯一动作。",
        });
      }
    }),
});

export const updateSliceFigureSchema = createSliceFigureSchema.omit({
  type: true,
  avatar: true,
  cover: true,
});

export const createPrimeWorldPlaceholderSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-world"),
});
