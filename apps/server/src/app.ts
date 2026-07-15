import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { closeDatabase, initializeDatabase } from "./infra/database/mysql.js";
import { AgentRunQueue } from "./infra/redis/run-queue.js";
import { closeRedis, getRedis } from "./infra/redis/redis.js";
import { registerAgentRoutes } from "./modules/agents/agents.controller.js";
import { PrimeFigureWakeupScheduler } from "./modules/agents/kinds/prime-figure/prime-figure-silence.scheduler.js";
import { registerAuthDecorators } from "./modules/auth/auth.decorators.js";
import { registerAuthRoutes } from "./modules/auth/auth.controller.js";
import { registerInterfaceBindingRoutes } from "./modules/channels/channels.controller.js";
import { registerConversationRoutes } from "./modules/conversations/conversations.controller.js";
import { registerMessagingRoutes } from "./modules/messaging/messaging.controller.js";
import { registerRealtimeGateway } from "./modules/realtime/ws.gateway.js";
import { startRealtimeEventBus } from "./modules/realtime/realtime-event-bus.js";
import { registerResourceRoutes } from "./modules/resources/resources.controller.js";
import { ResourceProcessingQueue } from "./modules/resources/resource-processing.queue.js";
import { ResourceCleanupQueue } from "./modules/resources/resource-cleanup.queue.js";
import { registerRuntimeConfigRoutes } from "./modules/runtime-config/runtime-config.controller.js";
import { registerAdminRoutes } from "./modules/admin/admin.controller.js";
import { registerBillingRoutes } from "./modules/billing/billing.controller.js";
import { registerPlatformCatalogRoutes } from "./modules/platform-catalog/platform-catalog.controller.js";

export async function buildApp() {
  await initializeDatabase();
  await getRedis().catch((error) => {
    console.warn(
      "Redis is unavailable; cache and distributed jobs are degraded.",
      error,
    );
  });
  const app = Fastify({ logger: true });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  const primeWakeupScheduler = new PrimeFigureWakeupScheduler();
  const runQueue = new AgentRunQueue();
  const resourceQueue = new ResourceProcessingQueue();
  const resourceCleanupQueue = new ResourceCleanupQueue();
  const runService = new (
    await import("./modules/messaging/messaging.service.js")
  ).MessagingService();

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Range"],
    exposedHeaders: [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "ETag",
    ],
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret" });
  await app.register(websocket);
  registerAuthDecorators(app);

  app.get("/health", async () => ({
    ok: true,
    name: "echoo-server",
    storage: "mysql",
    mediaStorage:
      process.env.RESOURCE_STORAGE_PROVIDER === "s3" ? "s3" : "local",
    queue: "redis",
  }));

  await app.register(registerAuthRoutes, { prefix: "/api/auth" });
  await app.register(registerAgentRoutes, { prefix: "/api/agents" });
  await app.register(registerMessagingRoutes, { prefix: "/api" });
  await app.register(registerConversationRoutes, {
    prefix: "/api/conversations",
  });
  await app.register(registerInterfaceBindingRoutes, {
    prefix: "/api/interface-bindings",
  });
  await app.register(registerResourceRoutes, { prefix: "/api/resources" });
  await app.register(registerRuntimeConfigRoutes, { prefix: "/api" });
  await app.register(registerBillingRoutes, { prefix: "/api" });
  await app.register(registerPlatformCatalogRoutes, { prefix: "/api" });
  await app.register(registerAdminRoutes, { prefix: "/api/admin" });
  await app.register(registerRealtimeGateway);
  app.addHook("onReady", async () => {
    await startRealtimeEventBus().catch((error) => {
      app.log.warn(error, "Redis realtime fan-out unavailable");
    });
    primeWakeupScheduler.start();
    void runQueue
      .start(
        (job) => runService.processQueuedRun(job),
        (activity) => runService.publishAgentActivity(activity),
      )
      .catch((error) => app.log.error(error, "Agent run worker stopped"));
    void resourceQueue
      .recoverFromDatabase()
      .then(() => resourceQueue.start())
      .catch((error) =>
        app.log.error(error, "Resource processing worker stopped"),
      );
    void resourceCleanupQueue
      .start()
      .catch((error) =>
        app.log.error(error, "Resource cleanup worker stopped"),
      );
  });
  app.addHook("onClose", async () => {
    primeWakeupScheduler.stop();
    runQueue.stop();
    resourceQueue.stop();
    resourceCleanupQueue.stop();
    await closeRedis();
    await closeDatabase();
  });

  return app;
}
