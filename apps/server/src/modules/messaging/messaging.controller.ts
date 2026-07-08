import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessagingService } from "./messaging.service.js";

const createTextMessageSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  clientMessageId: z.string().trim().min(1).max(200).optional()
});

export async function registerMessagingRoutes(app: FastifyInstance) {
  const messaging = new MessagingService();

  app.get<{ Querystring: { after?: string; conversationId?: string } }>("/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    return messaging.listMessages(userId, request.query.after, request.query.conversationId);
  });

  app.get<{ Params: { conversationId: string } }>("/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const messages = messaging.listConversationMessages(userId, request.params.conversationId);
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
        message: parsed.error.issues[0]?.message ?? "Invalid message."
      });
    }

    const result = await messaging.createUserTextMessage({
      ownerUserId: userId,
      conversationId: request.params.conversationId,
      text: parsed.data.text,
      clientMessageId: parsed.data.clientMessageId
    });

    if (!result) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { id: string }; Body?: { readAt?: number } }>("/messages/:id/read", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const updated = messaging.markRead(userId, request.params.id, request.body?.readAt ?? Date.now());
    if (!updated) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    return { ok: true };
  });
}
