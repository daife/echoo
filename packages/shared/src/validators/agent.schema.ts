import { z } from "zod";

const requiredText = (label: string, max = 2000) => z.string().trim().min(1, `${label} is required.`).max(max);
const optionalText = (max = 2000) => z.string().trim().max(max).optional().default("");

const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  dataBase64: z.string().min(1)
});

export const agentAttributeSchema = z.object({
  key: requiredText("Attribute key", 80),
  value: requiredText("Attribute value", 240)
});

const createAgentBaseSchema = z.object({
  avatar: imageUploadSchema.nullish(),
  cover: imageUploadSchema.nullish(),
  name: requiredText("Agent name", 80),
  attributes: z.array(agentAttributeSchema).max(50).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional().default([]),
  introduction: optionalText(2000),
  isPublic: z.boolean()
});

export const createSliceFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("slice-figure"),
  prologueHtml: optionalText(12000),
  currentSituation: optionalText(4000),
  openingLine: optionalText(2000),
  linkedAgentIds: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("Persona"),
  background: requiredText("Background"),
  personality: requiredText("Personality"),
  responseStyle: requiredText("Response style")
});

const primeVariableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export const primeFigureVariableDefinitionSchema = z.object({
  key: requiredText("Variable key", 80),
  label: requiredText("Variable label", 120),
  type: z.enum(["string", "number", "boolean", "json"]),
  description: optionalText(1000),
  defaultValue: primeVariableValueSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  llmWritable: z.boolean().optional().default(true)
});

export const primeFigureMemorySchema = z.object({
  id: z.string().trim().min(1).max(120),
  content: requiredText("Memory", 4000),
  importance: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(100).optional().default([]),
  createdAt: z.number().nonnegative()
});

export const primeFigureStateSchema = z.object({
  currentSchedule: z.record(z.string(), z.unknown()).optional().default({}),
  itinerary: z.record(z.string(), z.unknown()).optional().default({}),
  variables: z.record(z.string(), primeVariableValueSchema).optional().default({}),
  memories: z.array(primeFigureMemorySchema).max(1000).optional().default([]),
  mood: optionalText(500),
  relationshipStatus: optionalText(500),
  nextWakeupAtMs: z.number().nonnegative().optional(),
  updatedAt: z.number().nonnegative()
});

export const createPrimeFigureSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-figure"),
  persona: requiredText("Persona"),
  background: requiredText("Background"),
  personality: requiredText("Personality"),
  responseStyle: requiredText("Response style"),
  decisionStyle: optionalText(4000),
  currentSituation: optionalText(4000),
  schedule: z.record(z.string(), z.unknown()).optional().default({}),
  itinerary: z.record(z.string(), z.unknown()).optional().default({}),
  variableDefinitions: z.array(primeFigureVariableDefinitionSchema).max(100).optional().default([]),
  initialVariables: z.record(z.string(), primeVariableValueSchema).optional().default({}),
  initialMood: optionalText(500),
  initialRelationshipStatus: optionalText(500)
});

export const updatePrimeFigureSchema = createPrimeFigureSchema.omit({
  type: true,
  avatar: true,
  cover: true,
  initialVariables: true,
  initialMood: true,
  initialRelationshipStatus: true
});

const urlLikeSchema = z.string().trim().min(1).max(2048);

export const primeMessageContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: requiredText("Text", 12000)
  }),
  z.object({
    type: z.literal("image"),
    description: requiredText("Image description", 4000),
    generationPrompt: optionalText(4000),
    referenceResourceUrls: z.array(urlLikeSchema).max(20).optional().default([]),
    resourceUrl: urlLikeSchema.optional()
  }),
  z.object({
    type: z.literal("video"),
    description: requiredText("Video description", 4000),
    resourceUrl: urlLikeSchema
  }),
  z.object({
    type: z.literal("voice"),
    transcript: requiredText("Voice transcript", 12000),
    resourceUrl: urlLikeSchema.optional()
  }),
  z.object({
    type: z.literal("sticker"),
    stickerId: requiredText("Sticker id", 120),
    description: requiredText("Sticker description", 1000),
    resourceUrl: urlLikeSchema.optional()
  }),
  z.object({
    type: z.literal("transfer"),
    note: optionalText(500),
    amount: z.number().finite().nonnegative(),
    currency: z.string().trim().min(1).max(16).default("CNY"),
    direction: z.enum(["received", "paid"])
  })
]);

export const primeMessageSchema = z.object({
  id: z.string().trim().min(1).max(120),
  ownerUserId: z.string().trim().min(1).max(120),
  agentId: z.string().trim().min(1).max(120),
  conversationId: z.string().trim().min(1).max(120),
  sender: z.enum(["prime_figure", "end_user", "system"]),
  direction: z.enum(["incoming", "outgoing", "internal"]),
  messageType: z.enum(["text", "image", "video", "voice", "sticker", "transfer"]),
  content: primeMessageContentSchema,
  occurredAtMs: z.number().nonnegative(),
  occurredAtIso: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(80),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative()
});

export const primeFigureActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_message"),
    message: primeMessageContentSchema,
    delayMinutes: z.number().nonnegative().optional(),
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("schedule_message"),
    message: primeMessageContentSchema,
    sendAtMs: z.number().nonnegative(),
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("update_schedule"),
    patch: z.record(z.string(), z.unknown()),
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("update_itinerary"),
    patch: z.record(z.string(), z.unknown()),
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("mutate_variable"),
    key: requiredText("Variable key", 80),
    operation: z.enum(["set", "increment", "decrement"]),
    value: primeVariableValueSchema,
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("upsert_memory"),
    content: requiredText("Memory", 4000),
    importance: z.number().min(0).max(1),
    sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(100).optional().default([]),
    actionRationale: requiredText("Action rationale", 1000)
  }),
  z.object({
    type: z.literal("silence"),
    revisitAfterMinutes: z.number().nonnegative().optional(),
    actionRationale: requiredText("Action rationale", 1000)
  })
]);

export const primeFigureDecisionSchema = z.object({
  decisionSummary: requiredText("Decision summary", 2000),
  stateAssessment: z.object({
    userIntent: requiredText("User intent", 1000),
    figureMood: requiredText("Figure mood", 1000),
    relationshipSignal: optionalText(1000),
    riskLevel: z.enum(["low", "medium", "high"])
  }),
  actions: z.array(primeFigureActionSchema).max(20).default([]),
  memoryWrites: z
    .array(
      z.object({
        content: requiredText("Memory", 4000),
        importance: z.number().min(0).max(1),
        sourceMessageIds: z.array(z.string().trim().min(1).max(120)).max(100).optional().default([])
      })
    )
    .max(20)
    .default([]),
  nextWakeupAtMs: z.number().nonnegative().optional()
});

export const updateSliceFigureSchema = createSliceFigureSchema.omit({
  type: true,
  avatar: true,
  cover: true
});

export const createPrimeFigurePlaceholderSchema = createPrimeFigureSchema;

export const createPrimeWorldPlaceholderSchema = createAgentBaseSchema.extend({
  type: z.literal("prime-world")
});
