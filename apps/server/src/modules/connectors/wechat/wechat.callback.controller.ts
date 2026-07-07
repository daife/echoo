import type { FastifyInstance } from "fastify";

export async function registerWechatCallback(app: FastifyInstance) {
  app.post("/wechat/callback", async () => ({ ok: true }));
}
