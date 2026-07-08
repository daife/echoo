import type { FastifyInstance } from "fastify";
import { ConversationsService } from "./conversations.service.js";

export async function registerConversationRoutes(app: FastifyInstance) {
  const conversations = new ConversationsService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return conversations.listConversations(userId);
  });
}
