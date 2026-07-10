import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessagingService } from "./messaging.service.js";

const createTextMessageSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  clientMessageId: z.string().trim().min(1).max(200).optional(),
  stream: z.boolean().optional()
});

const rollbackConversationSchema = z.object({
  messageId: z.string().trim().min(1)
});

const listMessagesQuerySchema = z.object({
  after: z.string().trim().min(1).optional(),
  before: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export async function registerMessagingRoutes(app: FastifyInstance) {
  const messaging = new MessagingService();

  app.get<{ Querystring: { after?: string; conversationId?: string; limit?: number } }>("/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = listMessagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "消息查询无效。"
      });
    }

    const query = parsed.data;
    return messaging.listMessages(userId, query.after, query.conversationId, query.limit);
  });

  app.get<{
    Params: { conversationId: string };
    Querystring: { after?: string; before?: string; limit?: number };
  }>("/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = listMessagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "消息查询无效。"
      });
    }

    const query = parsed.data;
    const messages = messaging.listConversationMessages(userId, request.params.conversationId, query);
    if (!messages) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    return messages;
  });

  app.post<{ Params: { conversationId: string }; Body: unknown }>("/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = createTextMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "消息无效。"
      });
    }

    const result = await messaging.createUserTextMessage({
      ownerUserId: userId,
      conversationId: request.params.conversationId,
      text: parsed.data.text,
      clientMessageId: parsed.data.clientMessageId,
      stream: parsed.data.stream ?? true
    });

    if (!result) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { conversationId: string }; Body: unknown }>("/conversations/:conversationId/rollback", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = rollbackConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "回溯请求无效。"
      });
    }

    const result = messaging.rollbackConversation(userId, request.params.conversationId, parsed.data.messageId);
    if (result.kind === "not_found") return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    if (result.kind === "message_not_found") return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    if (result.kind === "unsupported_type") {
      return reply.code(409).send({
        error: "ROLLBACK_UNSUPPORTED",
        message: "只有切片角色会话支持回溯。"
      });
    }

    return {
      ok: true,
      retainedThroughMessageId: result.retainedThroughMessageId,
      deletedCount: result.deletedCount
    };
  });

  app.post<{ Params: { id: string }; Body?: { readAt?: number } }>("/messages/:id/read", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const updated = messaging.markRead(userId, request.params.id, request.body?.readAt ?? Date.now());
    if (!updated) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    return { ok: true };
  });
}
