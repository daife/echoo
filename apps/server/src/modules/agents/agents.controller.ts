import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { CreateSliceFigureRequest } from "@echoo/shared";
import { AgentsService } from "./agents.service.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  const agents = new AgentsService();

  app.get("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return agents.listMyAgents(userId);
  });

  app.post<{ Body: CreateSliceFigureRequest }>("/", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    try {
      const agent = agents.createSliceFigure(userId, request.body);
      return reply.code(201).send({ agent });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "Invalid agent." });
      }
      throw error;
    }
  });
}
