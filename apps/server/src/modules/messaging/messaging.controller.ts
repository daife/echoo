import type { FastifyInstance } from "fastify";
import { MessagingService } from "./messaging.service.js";

export async function registerMessagingRoutes(app: FastifyInstance) {
  const messaging = new MessagingService();

  app.get<{ Querystring: { after?: string } }>("/messages", async (request) => {
    return messaging.listMessages(request.query.after);
  });

  app.post<{ Params: { id: string }; Body: { readAt?: number } }>("/messages/:id/read", async (request, reply) => {
    const updated = messaging.markRead(request.params.id, request.body.readAt ?? Date.now());
    if (!updated) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    return { ok: true };
  });
}
