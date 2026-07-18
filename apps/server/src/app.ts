import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { environment } from "./infra/config/environment.js";
import { closeDatabase, initializeDatabase } from "./infra/database/mysql.js";
import { AgentRunQueue } from "./infra/redis/run-queue.js";
import { closeRedis, getRedis } from "./infra/redis/redis.js";
import { registerAgentRoutes } from "./modules/agents/agents.controller.js";
import { PrimeFigureWakeupScheduler } from "./modules/agents/kinds/prime-figure/prime-figure-silence.scheduler.js";
import { registerAuthDecorators } from "./modules/auth/auth.decorators.js";
import { registerAuthRoutes } from "./modules/auth/auth.controller.js";
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
import { registerCharacterAssetRoutes } from "./modules/character-assets/character-assets.controller.js";
import { registerSocialRoutes } from "./modules/social/social.controller.js";
import { registerSocialPostRoutes } from "./modules/posts/social-post.controller.js";
import { registerUsersRoutes } from "./modules/users/users.controller.js";
import { registerSyncRoutes } from "./modules/sync/sync.controller.js";
import { ChangeEventDispatcher } from "./modules/sync/change-event.dispatcher.js";
import { ChangeEventRepository } from "./modules/sync/change-event.repository.js";
import { wsSessionManager } from "./modules/realtime/ws-session-manager.js";
import { registerRewardsRoutes } from "./modules/rewards/rewards.controller.js";

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
  const changeEventDispatcher = new ChangeEventDispatcher();
  const changeEvents = new ChangeEventRepository();
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
  await app.register(jwt, { secret: environment.jwtSecret });
  await app.register(websocket);
  registerAuthDecorators(app);

  app.get("/health", async () => {
    const [outbox, agentRuns, resourceProcessing, scheduler] =
      await Promise.all([
        changeEvents.outboxMetrics(),
        runQueue.metrics(),
        resourceQueue.metrics(),
        primeWakeupScheduler.metrics(),
      ]);
    return {
      ok: true,
      name: "echoo-server",
      storage: "mysql",
      mediaStorage: environment.resourceStorageProvider,
      queue: "redis",
      metrics: {
        realtime: wsSessionManager.snapshot(),
        outbox,
        queues: { agentRuns, resourceProcessing },
        scheduler,
      },
    };
  });

  await app.register(registerAuthRoutes, { prefix: "/api/auth" });
  await app.register(registerAgentRoutes, { prefix: "/api/agents" });
  await app.register(registerMessagingRoutes, { prefix: "/api" });
  await app.register(registerConversationRoutes, {
    prefix: "/api/conversations",
  });
  await app.register(registerResourceRoutes, { prefix: "/api/resources" });
  await app.register(registerRuntimeConfigRoutes, { prefix: "/api" });
  await app.register(registerBillingRoutes, { prefix: "/api" });
  await app.register(registerRewardsRoutes, { prefix: "/api" });
  await app.register(registerPlatformCatalogRoutes, { prefix: "/api" });
  await app.register(registerCharacterAssetRoutes, { prefix: "/api" });
  await app.register(registerSocialRoutes, { prefix: "/api" });
  await app.register(registerSocialPostRoutes, { prefix: "/api" });
  await app.register(registerUsersRoutes, { prefix: "/api" });
  await app.register(registerSyncRoutes, { prefix: "/api" });
  await app.register(registerAdminRoutes, { prefix: "/api/admin" });
  await app.register(registerRealtimeGateway);
  app.addHook("onReady", async () => {
    await startRealtimeEventBus().catch((error) => {
      app.log.warn(error, "Redis realtime fan-out unavailable");
    });
    await changeEventDispatcher
      .start()
      .catch((error) =>
        app.log.error(error, "Change event dispatcher stopped"),
      );
    await primeWakeupScheduler
      .start()
      .catch((error) => app.log.error(error, "Prime wakeup scheduler stopped"));
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
    changeEventDispatcher.stop();
    await closeRedis();
    await closeDatabase();
  });

  return app;
}
