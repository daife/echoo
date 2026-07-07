import type { FastifyInstance } from "fastify";

export async function registerQqWebhook(app: FastifyInstance) {
  app.post("/qq/webhook", async () => ({ ok: true }));
}
