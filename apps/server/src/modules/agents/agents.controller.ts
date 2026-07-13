import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { CreatePrimeFigureRequest, CreateSliceFigureRequest, UpdatePrimeFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import { AgentsService } from "./agents.service.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  const agents = new AgentsService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return await agents.listMyAgents(userId);
  });

  app.get<{ Params: { agentId: string } }>("/:agentId/prime-figure/edit", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const snapshot = await agents.getPrimeFigureEditSnapshot(userId, request.params.agentId);
    if (!snapshot)
      return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初角色。" });
    return snapshot;
  });

  app.get<{ Params: { agentId: string } }>("/:agentId/export", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const exported = await agents.exportAgent(userId, request.params.agentId);
    if (!exported)
      return reply.code(404).send({ error: "NOT_FOUND", message: "未找到可导出的角色。" });
    return exported;
  });

  app.post<{ Body: CreateSliceFigureRequest | CreatePrimeFigureRequest }>("/", { bodyLimit: 96 * 1024 * 1024 }, async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = await agents.createAgent(userId, request.body);
      return reply.code(201).send({ agent });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "角色数据无效。" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { agentId: string }; Body: UpdatePrimeFigureRequest }>("/:agentId/prime-figure", { bodyLimit: 96 * 1024 * 1024 }, async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = await agents.updatePrimeFigure(userId, request.params.agentId, request.body);
      if (!agent) return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初角色。" });
      return { agent };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "角色数据无效。" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { agentId: string }; Body: UpdateSliceFigureRequest }>("/:agentId", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = await agents.updateSliceFigure(userId, request.params.agentId, request.body);
      if (!agent) return reply.code(404).send({ error: "NOT_FOUND", message: "未找到角色。" });
      return { agent };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "角色数据无效。" });
      }
      throw error;
    }
  });
}
