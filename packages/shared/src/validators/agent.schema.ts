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

export const createSliceFigureSchema = z.object({
  type: z.literal("slice-figure"),
  avatar: imageUploadSchema.nullish(),
  cover: imageUploadSchema.nullish(),
  name: requiredText("Agent name", 80),
  attributes: z.array(agentAttributeSchema).max(50).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional().default([]),
  introduction: optionalText(2000),
  prologueHtml: optionalText(12000),
  currentSituation: optionalText(4000),
  openingLine: optionalText(2000),
  isPublic: z.boolean(),
  linkedAgentIds: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  unlockConditions: z.record(z.string(), z.unknown()).nullish(),
  persona: requiredText("Persona"),
  background: requiredText("Background"),
  personality: requiredText("Personality"),
  responseStyle: requiredText("Response style")
});

export const updateSliceFigureSchema = createSliceFigureSchema.omit({
  type: true,
  avatar: true,
  cover: true
});
