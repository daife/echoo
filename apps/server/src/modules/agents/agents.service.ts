import { createSliceAgentSchema } from "@echoo/shared";
import type { CreateSliceAgentRequest } from "@echoo/shared";
import { AgentRepository } from "./agent.repository.js";

export class AgentsService {
  constructor(private readonly repository = new AgentRepository()) {}

  listMyAgents(userId: string) {
    return this.repository.listByOwner(userId);
  }

  createSliceAgent(userId: string, input: CreateSliceAgentRequest) {
    const body = createSliceAgentSchema.parse(input);
    return this.repository.createSlice(userId, body);
  }
}
