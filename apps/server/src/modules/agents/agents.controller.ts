import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { addPrimeFigureStickerSchema } from "@echoo/shared";
import type {
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";
import { InvalidMediaUploadError } from "../resources/resource.repository.js";
import { AgentsService } from "./agents.service.js";
import { PrimeWorldService } from "./kinds/prime-world/prime-world.service.js";
import { PrimeWorldCompileError } from "./kinds/prime-world/prime-world-compiler.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  const agents = new AgentsService();
  const worlds = new PrimeWorldService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return await agents.listMyAgents(userId);
  });

  app.get<{ Params: { agentId: string } }>(
    "/:agentId/prime-figure/edit",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const snapshot = await agents.getPrimeFigureEditSnapshot(
        userId,
        request.params.agentId,
      );
      if (!snapshot)
        return reply
          .code(404)
          .send({ error: "NOT_FOUND", message: "未找到本初角色。" });
      return snapshot;
    },
  );

  app.get<{ Params: { agentId: string } }>(
    "/:agentId/export",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const exported = await agents.exportAgent(userId, request.params.agentId);
      if (!exported)
        return reply
          .code(404)
          .send({ error: "NOT_FOUND", message: "未找到可导出的角色。" });
      return exported;
    },
  );

  app.post<{ Body: CreateSliceFigureRequest | CreatePrimeFigureRequest | CreatePrimeWorldRequest }>(
    "/",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      try {
        const agent = await agents.createAgent(userId, request.body);
        return reply.code(201).send({ agent });
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: error.issues[0]?.message ?? "角色数据无效。",
          });
        }
        if (error instanceof InvalidMediaUploadError) {
          return reply
            .code(400)
            .send({ error: "INVALID_MEDIA_UPLOAD", message: error.message });
        }
        if (error instanceof PrimeWorldCompileError)
          return reply.code(400).send({ error: error.code, message: error.message, issue: error.validationIssue });
        if (request.body.type === "prime-world" && error instanceof Error)
          return reply.code(400).send({ error: "PRIME_WORLD_INVALID", message: error.message });
        throw error;
      }
    },
  );

  app.patch<{ Params: { agentId: string }; Body: UpdatePrimeWorldRequest }>(
    "/:agentId/prime-world",
    { bodyLimit: 2 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const agent = await agents.updatePrimeWorld(userId, request.params.agentId, request.body);
        if (!agent) return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初世界。" });
        return { agent };
      } catch (error) {
        if (error instanceof ZodError) return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "本初世界定义无效。" });
        if (error instanceof PrimeWorldCompileError) return reply.code(400).send({ error: error.code, message: error.message, issue: error.validationIssue });
        if (error instanceof Error && (error.message.startsWith("世界资源") || error.message.includes("stateSchema") || error.message.includes("运行状态")))
          return reply.code(400).send({ error: "PRIME_WORLD_INVALID", message: error.message });
        throw error;
      }
    },
  );

  app.post<{ Params: { agentId: string } }>(
    "/:agentId/prime-world/reset",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const agent = await agents.getAgent(userId, request.params.agentId);
      if (!agent || agent.type !== "prime-world")
        return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初世界。" });
      return reply.code(202).send(await worlds.reset(userId, agent.conversationId));
    },
  );

  app.patch<{ Params: { agentId: string }; Body: UpdatePrimeFigureRequest }>(
    "/:agentId/prime-figure",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      try {
        const agent = await agents.updatePrimeFigure(
          userId,
          request.params.agentId,
          request.body,
        );
        if (!agent)
          return reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "未找到本初角色。" });
        return { agent };
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: error.issues[0]?.message ?? "角色数据无效。",
          });
        }
        if (error instanceof InvalidMediaUploadError) {
          return reply
            .code(400)
            .send({ error: "INVALID_MEDIA_UPLOAD", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { agentId: string }; Body: unknown }>(
    "/:agentId/prime-figure/stickers",
    { bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const input = addPrimeFigureStickerSchema.parse(request.body);
        const agent = await agents.addPrimeFigureSticker(
          userId,
          request.params.agentId,
          input,
        );
        if (!agent)
          return reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "未找到本初角色。" });
        return reply.code(201).send({ agent });
      } catch (error) {
        if (error instanceof ZodError)
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: error.issues[0]?.message ?? "表情数据无效。",
          });
        if (error instanceof InvalidMediaUploadError)
          return reply.code(400).send({
            error: "INVALID_MEDIA_UPLOAD",
            message: error.message,
          });
        if (error instanceof Error && error.message.includes("20 个上限"))
          return reply.code(409).send({
            error: "STICKER_LIMIT_REACHED",
            message: error.message,
          });
        throw error;
      }
    },
  );

  app.delete<{ Params: { agentId: string; stickerId: string } }>(
    "/:agentId/prime-figure/stickers/:stickerId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const agent = await agents.deletePrimeFigureSticker(
        userId,
        request.params.agentId,
        request.params.stickerId,
      );
      if (!agent)
        return reply.code(404).send({
          error: "STICKER_NOT_FOUND",
          message: "未找到该表情。",
        });
      return { agent };
    },
  );

  app.patch<{ Params: { agentId: string }; Body: UpdateSliceFigureRequest }>(
    "/:agentId",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      try {
        const agent = await agents.updateSliceFigure(
          userId,
          request.params.agentId,
          request.body,
        );
        if (!agent)
          return reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "未找到角色。" });
        return { agent };
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: error.issues[0]?.message ?? "角色数据无效。",
          });
        }
        if (error instanceof InvalidMediaUploadError) {
          return reply
            .code(400)
            .send({ error: "INVALID_MEDIA_UPLOAD", message: error.message });
        }
        throw error;
      }
    },
  );
}
