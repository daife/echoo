import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { CreateSliceAgentRequest } from "@echoo/shared";
import { AgentsService } from "./agents.service.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  const agents = new AgentsService();

  app.get("/", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request, reply);
    if (!userId) return;
    return agents.listMyAgents(userId);
  });

  app.post<{ Body: CreateSliceAgentRequest }>("/", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request, reply);
    if (!userId) return;

    try {
      const agent = agents.createSliceAgent(userId, request.body);
      return reply.code(201).send({ agent });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "Invalid agent." });
      }
      throw error;
    }
  });
}

async function getAuthenticatedUserId(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<{ sub: string }>();
    return payload.sub;
  } catch {
    reply.code(401).send({ error: "UNAUTHORIZED", message: "Please sign in again." });
    return null;
  }
}
