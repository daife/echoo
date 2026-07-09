import { createSliceFigureSchema } from "@echoo/shared";
import type { CreateSliceFigureRequest } from "@echoo/shared";
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
}
