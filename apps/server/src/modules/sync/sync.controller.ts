import type { FastifyInstance } from "fastify";
import { SyncService } from "./sync.service.js";

export async function registerSyncRoutes(app: FastifyInstance) {
  const sync = new SyncService();
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    "/sync",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const after = parseNonNegativeInteger(request.query.after, 0);
      const limit = parseNonNegativeInteger(request.query.limit, 500);
      return sync.list(userId, after, limit);
    },
  );
  app.get("/sync/bootstrap", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return sync.bootstrap(userId);
  });
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
