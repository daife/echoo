import { z } from "zod";

export const messageContentSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  fileName: z.string().optional(),
  raw: z.unknown().optional()
});

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  contentType: z.enum(["text", "image", "file", "voice", "video", "system"]),
  content: messageContentSchema,
  status: z.enum(["pending", "sent", "delivered", "failed", "read"]),
  createdAt: z.number(),
  updatedAt: z.number()
});
