import { z } from "zod";

const mediaVariantSchema = z.enum(["original", "thumb", "display"]);
const mediaReferenceBaseSchema = z.object({
  resourceId: z.string().trim().min(1),
  variants: z.array(mediaVariantSchema),
});
const visualMediaReferenceSchema = mediaReferenceBaseSchema.extend({
  kind: z.enum(["image", "sticker", "video"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const nonVisualMediaReferenceSchema = mediaReferenceBaseSchema.extend({
  kind: z.enum(["voice", "file"]),
});

export const mediaReferenceSchema = z.union([
  visualMediaReferenceSchema,
  nonVisualMediaReferenceSchema,
]);

export const messageContentSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z
    .string()
    .refine(
      (value) => /^https?:\/\//i.test(value) || value.startsWith("/"),
      "媒体地址必须是 URL 或站内绝对路径。",
    )
    .optional(),
  fileName: z.string().optional(),
  resourceId: z.string().optional(),
  media: mediaReferenceSchema.optional(),
});

export const messageSchema = z.object({
  id: z.string(),
  clientMessageId: z.string().optional(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  contentType: z.enum(["text", "image", "file", "voice", "video", "system"]),
  content: messageContentSchema,
  status: z.enum(["pending", "sent", "delivered", "failed", "read"]),
  providerId: z.string().optional(),
  model: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  readAt: z.number().optional(),
});
