import type { FastifyInstance } from "fastify";
import { NotificationRepository } from "./notification.repository.js";

export async function registerNotificationRoutes(app: FastifyInstance) {
  const notifications = new NotificationRepository();

  app.get("/notifications/state", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return notifications.getState(userId);
  });

  app.post("/notifications/activity/read", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return notifications.markActivityRead(userId);
  });
}
