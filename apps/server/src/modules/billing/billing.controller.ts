import type { FastifyInstance } from "fastify";
import { BillingService } from "./billing.service.js";

export async function registerBillingRoutes(app: FastifyInstance) {
  const service = new BillingService();
  app.get("/users/me/wallet", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return service.getWallet(userId);
  });
}
