import { createSliceFigureSchema, updateSliceFigureSchema } from "@echoo/shared";
import type { CreateSliceFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import { AgentRepository } from "./agent.repository.js";

export class AgentsService {
  constructor(private readonly repository = new AgentRepository()) {}

  listMyAgents(userId: string) {
    return this.repository.listByOwner(userId);
  }

  createSliceFigure(userId: string, input: CreateSliceFigureRequest) {
    const body = createSliceFigureSchema.parse(input);
    return this.repository.createSliceFigure(userId, body);
  }

  updateSliceFigure(userId: string, agentId: string, input: UpdateSliceFigureRequest) {
    const body = updateSliceFigureSchema.parse(input);
    return this.repository.updateSliceFigure(userId, agentId, body);
  }
}
