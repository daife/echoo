import { z } from "zod";

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label}不能为空。`);
const optionalText = () => z.string().trim().optional().default("");
const generationPromptSchema = requiredText("生图提示词");

const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.literal("image/jpeg"),
  dataBase64: z.string().min(1),
});

const primeFigureReferenceImageInputSchema = z.union([
  z
    .object({
      resourceId: z.string().trim().min(1).max(120),
      description: requiredText("图片描述"),
    })
    .strict(),
  z
    .object({
      upload: imageUploadSchema,
      description: requiredText("图片描述"),
    })
    .strict(),
]);

const primeFigureStickerInputSchema = z.union([
  z
    .object({
      resourceId: z.string().trim().min(1).max(120),
      description: requiredText("表情描述").max(500),
    })
    .strict(),
  z
    .object({
      upload: imageUploadSchema,
      description: requiredText("表情描述").max(500),
    })
    .strict(),
]);

export const agentAttributeSchema = z.object({
  key: requiredText("属性键"),
  value: requiredText("属性值"),
});

const createAgentBaseSchema = z.object({
  avatar: imageUploadSchema.nullish(),
  cover: imageUploadSchema.nullish(),
  name: requiredText("角色名称").max(160),
  attributes: z.array(agentAttributeSchema).optional().default([]),
  tags: z.array(z.string().trim().min(1)).optional().default([]),
  introduction: optionalText(),
  isPublic: z.boolean(),
});

export const createSliceFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("slice-figure"),
  prologueHtml: optionalText(),
  currentSituation: optionalText(),
  openingLine: optionalText(),
  linkedAgentIds: z
    .array(z.string().trim().min(1).max(120))
    .optional()
    .default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("人设"),
  background: requiredText("背景"),
  personality: requiredText("性格"),
  responseStyle: requiredText("回复风格"),
  systemPrompt: requiredText("系统提示词"),
  memorySummaryPrompt: requiredText("记忆总结提示词"),
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
    key: requiredText("变量键").regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "变量键必须符合 JSON Schema 的安全命名规则。",
    ),
    label: requiredText("变量标签"),
    type: z.enum(["string", "number", "boolean", "json"]),
    description: requiredText("变量描述"),
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
  content: requiredText("记忆"),
  eventAtMs: z.number().nonnegative(),
  recordedAtMs: z.number().nonnegative(),
});

const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须采用 HH:mm 格式。");

export const primeFigureScheduleSchema = z.object({
  segments: z.array(
    z.object({
      label: requiredText("日程时段名称"),
      days: z
        .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
        .min(1)
        .max(7),
      start: clockTimeSchema,
      end: clockTimeSchema,
      description: requiredText("日程时段描述"),
    }),
  ),
});

export const primeFigureStateSchema = z.object({
  variables: z
    .record(z.string(), primeVariableValueSchema)
    .optional()
    .default({}),
  memories: z.array(primeFigureMemorySchema).optional().default([]),
  currentSituation: optionalText(),
  schedule: primeFigureScheduleSchema.optional().default({ segments: [] }),
  itinerary: optionalText(),
  mood: optionalText(),
  moodObservedAtMs: z.number().nonnegative(),
  relationshipStatus: optionalText(),
  silenceStartedAtMs: z.number().nonnegative().optional(),
  silenceUntilMs: z.number().nonnegative().optional(),
  lastFigureActivityAtMs: z.number().nonnegative().optional(),
  proactiveWakeup: z
    .object({
      token: z.string().trim().min(1),
      scheduledAtMs: z.number().nonnegative(),
      dueAtMs: z.number().nonnegative(),
      interactionAfterSequence: z.number().int().nonnegative(),
      interactionInvalidationWindowMinutes: z.number().int().nonnegative(),
      lease: z
        .object({
          leaseUntilMs: z.number().nonnegative(),
          deliveryAttempts: z.number().int().positive(),
        })
        .optional(),
    })
    .optional(),
  passiveWakeup: z
    .object({
      token: z.string().trim().min(1),
      stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      anchorActivityAtMs: z.number().nonnegative(),
      dueAtMs: z.number().nonnegative(),
      baselineEndUserSequence: z.number().int().nonnegative(),
      milestonesMinutes: z
        .tuple([
          z.number().int().positive(),
          z.number().int().positive(),
          z.number().int().positive(),
        ])
        .refine(
          ([first, second, third]) => first < second && second < third,
          "被动唤醒时间必须严格递增。",
        ),
      lease: z
        .object({
          leaseUntilMs: z.number().nonnegative(),
          deliveryAttempts: z.number().int().positive(),
        })
        .optional(),
    })
    .optional(),
  passiveWakeupExhaustedAfterEndUserSequence: z
    .number()
    .int()
    .nonnegative()
    .optional(),
  updatedAt: z.number().nonnegative(),
});

export const createPrimeFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-figure"),
  prologueHtml: optionalText(),
  linkedAgentIds: z
    .array(z.string().trim().min(1).max(120))
    .optional()
    .default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("人设"),
  background: requiredText("背景"),
  personality: requiredText("性格"),
  responseStyle: requiredText("回复风格"),
  decisionStyle: optionalText(),
  currentSituation: optionalText(),
  schedule: primeFigureScheduleSchema.optional().default({ segments: [] }),
  itinerary: optionalText(),
  variableDefinitions: z
    .array(primeFigureVariableDefinitionSchema)
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
    .optional()
    .default([]),
  stickers: z
    .array(primeFigureStickerInputSchema)
    .max(20, "每个本初角色最多可添加 20 个表情。")
    .optional()
    .default([]),
  initialMood: optionalText(),
  initialRelationshipStatus: optionalText(),
});

export const updatePrimeFigureSchema = createPrimeFigureSchema
  .omit({
    type: true,
    initialMood: true,
    initialRelationshipStatus: true,
    referenceImages: true,
    stickers: true,
  })
  .extend({
    referenceImages: z.array(primeFigureReferenceImageInputSchema).optional(),
    stickers: z.array(primeFigureStickerInputSchema).max(20).optional(),
    currentVariables: z.record(z.string(), primeVariableValueSchema),
    currentMood: z.string().trim(),
    currentRelationshipStatus: z.string().trim(),
  });

export const addPrimeFigureStickerSchema = z.object({
  upload: imageUploadSchema,
  description: requiredText("表情描述").max(500),
});

const urlLikeSchema = z.string().trim().min(1);

const primeImageContentSchema = z
  .object({
    type: z.literal("image"),
    description: z.string().trim().min(1).optional(),
    generationPrompt: optionalText(),
    referenceResourceUrls: z.array(urlLikeSchema).optional().default([]),
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
    description: z.string().trim().min(1).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  })
  .refine((content) => Boolean(content.description || content.resourceId), {
    message: "视频必须包含描述或资源 ID。",
  });

const primeVoiceContentSchema = z
  .object({
    type: z.literal("voice"),
    description: z.string().trim().min(1).optional(),
    transcript: z.string().trim().min(1).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  })
  .refine((content) => Boolean(content.transcript || content.resourceId), {
    message: "语音必须包含转写或资源 ID。",
  });

export const primeMessageContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: requiredText("文本"),
  }),
  primeImageContentSchema,
  primeVideoContentSchema,
  primeVoiceContentSchema,
  z.object({
    type: z.literal("sticker"),
    stickerId: requiredText("贴纸 ID").max(120),
    description: requiredText("贴纸描述"),
    resourceId: z.string().trim().min(1).max(120).optional(),
    resourceUrl: urlLikeSchema.optional(),
  }),
  z.object({
    type: z.literal("transfer"),
    transferId: requiredText("转账 ID").max(120),
    event: z.enum(["offer", "resolution"]),
    note: optionalText(),
    amount: z
      .number()
      .finite()
      .positive()
      .refine((value) => Number.isInteger(value * 100), {
        message: "转账金额最多保留两位小数。",
      }),
    currency: z.string().trim().min(1).default("CNY"),
    direction: z.enum(["received", "paid"]),
    status: z.enum(["pending", "accepted", "rejected"]),
    relatedTransferId: z.string().trim().min(1).max(120).optional(),
    resolvedAtMs: z.number().nonnegative().optional(),
    resolvedAtIso: z.string().trim().min(1).max(80).optional(),
  }),
]);

export const primeMediaAnnotationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(["image", "video"]),
    description: requiredText("媒体描述"),
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("voice"),
    transcript: requiredText("语音转写"),
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

// Transfer intentionally has two shapes under the same top-level action type,
// so this union cannot use `type` as a unique discriminator.
const primeFigureActionOutputSchema = z.union([
  z.object({
    type: z.literal("send_message"),
    message: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("text"),
        text: requiredText("文本"),
      }),
      z.object({
        type: z.literal("image"),
        description: optionalText(),
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
        transcript: requiredText("语音文本"),
      }),
      z.object({
        type: z.literal("sticker"),
        stickerId: requiredText("表情 ID").max(120),
      }),
    ]),
  }),
  z.object({
    type: z.literal("silence"),
  }),
  z.object({
    type: z.literal("mute"),
    revisitAfterMinutes: z.number().int().min(1).nullable(),
  }),
  z.object({
    type: z.literal("schedule_wakeup"),
    afterMinutes: z.number().int().min(1).nullable(),
  }),
  z.object({
    type: z.literal("transfer"),
    operation: z.literal("send"),
    amount: z
      .number()
      .finite()
      .positive()
      .refine((value) => Number.isInteger(value * 100), {
        message: "转账金额最多保留两位小数。",
      }),
    currency: z.literal("CNY"),
    note: z.string().trim().max(200).default(""),
  }),
  z.object({
    type: z.literal("transfer"),
    operation: z.enum(["accept", "reject"]),
    transferId: requiredText("转账 ID").max(120),
  }),
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
    action.type === "mute" ||
    action.type === "schedule_wakeup"
  )
    return { ...action, message: normalizedMessage };
  return { ...action, type: "send_message", message: normalizedMessage };
}

function isPrimeOutgoingMessageType(value: unknown) {
  return (
    value === "text" ||
    value === "image" ||
    value === "voice" ||
    value === "sticker"
  );
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
  rationale: requiredText("角色决策依据"),
  figureMood: requiredText("角色情绪"),
  variables: z.record(z.string(), primeVariableValueSchema),
  memoryWrites: z
    .array(
      z.object({
        content: requiredText("记忆"),
        eventAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .nullable(),
      }),
    )
    .optional()
    .default([]),
  stateUpdates: z
    .object({
      currentSituation: z.string().trim().nullish(),
      schedule: primeFigureScheduleSchema.nullish(),
      itinerary: z.string().trim().nullish(),
      relationshipStatus: z.string().trim().nullish(),
    })
    .optional()
    .default({}),
  actions: z.array(primeFigureActionSchema).optional().default([]),
});

export const updateSliceFigureSchema = createSliceFigureSchema.omit({
  type: true,
});

export const createPrimeWorldPlaceholderSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-world"),
});
