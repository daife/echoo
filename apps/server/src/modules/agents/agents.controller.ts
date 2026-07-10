import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { CreatePrimeFigureRequest, CreateSliceFigureRequest, UpdatePrimeFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import { AgentsService } from "./agents.service.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  const agents = new AgentsService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return agents.listMyAgents(userId);
  });

  app.post<{ Body: CreateSliceFigureRequest | CreatePrimeFigureRequest }>("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = agents.createAgent(userId, request.body);
      return reply.code(201).send({ agent });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "角色数据无效。" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { agentId: string }; Body: UpdatePrimeFigureRequest }>("/:agentId/prime-figure", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = agents.updatePrimeFigure(userId, request.params.agentId, request.body);
      if (!agent) return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初角色。" });
      return { agent };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "角色数据无效。" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { agentId: string }; Body: UpdateSliceFigureRequest }>("/:agentId", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = agents.updateSliceFigure(userId, request.params.agentId, request.body);
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
