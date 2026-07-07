import type { FastifyInstance } from "fastify";

export async function registerTelegramWebhook(app: FastifyInstance) {
  app.post("/telegram/webhook", async () => ({ ok: true }));
}
