import type { FastifyInstance } from "fastify";
import { ConversationsService } from "./conversations.service.js";

export async function registerConversationRoutes(app: FastifyInstance) {
  const conversations = new ConversationsService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return await conversations.listConversations(userId);
  });

  app.post<{ Params: { conversationId: string } }>(
    "/:conversationId/read",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const conversation = await conversations.markRead(
        userId,
        request.params.conversationId,
      );
      if (!conversation)
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return conversation;
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/:conversationId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      const deleted = await conversations.deleteConversation(
        userId,
        request.params.conversationId,
      );
      if (!deleted)
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return { ok: true };
    },
  );
}
