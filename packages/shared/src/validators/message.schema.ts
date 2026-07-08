import { z } from "zod";

export const messageContentSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  fileName: z.string().optional(),
  raw: z.unknown().optional()
});

export const messageSchema = z.object({
  id: z.string(),
  clientMessageId: z.string().optional(),
  conversationId: z.string(),
  senderId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  direction: z.enum(["incoming", "outgoing"]),
  contentType: z.enum(["text", "image", "file", "voice", "video", "system"]),
  content: messageContentSchema,
  status: z.enum(["pending", "sent", "delivered", "failed", "read"]),
  providerId: z.string().optional(),
  model: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  readAt: z.number().optional()
});
