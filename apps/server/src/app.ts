import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerAgentRoutes } from "./modules/agents/agents.controller.js";
import { PrimeFigureSilenceScheduler } from "./modules/agents/kinds/prime-figure/prime-figure-silence.scheduler.js";
import { registerAuthDecorators } from "./modules/auth/auth.decorators.js";
import { registerAuthRoutes } from "./modules/auth/auth.controller.js";
import { registerInterfaceBindingRoutes } from "./modules/channels/channels.controller.js";
import { registerConversationRoutes } from "./modules/conversations/conversations.controller.js";
import { registerMessagingRoutes } from "./modules/messaging/messaging.controller.js";
import { registerRealtimeGateway } from "./modules/realtime/ws.gateway.js";
import { registerResourceRoutes } from "./modules/resources/resources.controller.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  const primeSilenceScheduler = new PrimeFigureSilenceScheduler();

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret" });
  await app.register(websocket);
  registerAuthDecorators(app);

  app.get("/health", async () => ({ ok: true, name: "echoo-server" }));

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
  await app.register(registerRealtimeGateway);
  app.addHook("onReady", async () => primeSilenceScheduler.start());
  app.addHook("onClose", async () => primeSilenceScheduler.stop());

  return app;
}
