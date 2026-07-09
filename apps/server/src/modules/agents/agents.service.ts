import type { Agent, CreatePrimeFigureRequest, CreateSliceFigureRequest, UpdatePrimeFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import { AgentKindRegistry } from "./agent-kind.registry.js";
import { AgentRepository } from "./agent.repository.js";

export class AgentsService {
  constructor(
    private readonly repository = new AgentRepository(),
    private readonly kinds = new AgentKindRegistry()
  ) {}

  listMyAgents(userId: string) {
    return this.repository.listByOwner(userId);
  }

  createSliceFigure(userId: string, input: CreateSliceFigureRequest) {
    const handler = this.kinds.get("slice-figure");
    if (!handler) throw new Error("Slice Figure handler is not registered.");
    return handler.create(userId, input);
  }

  createPrimeFigure(userId: string, input: CreatePrimeFigureRequest) {
    const handler = this.kinds.get("prime-figure");
    if (!handler) throw new Error("Prime Figure handler is not registered.");
    return handler.create(userId, input);
  }

  createAgent(userId: string, input: CreateSliceFigureRequest | CreatePrimeFigureRequest): Agent {
    if (input.type === "prime-figure") return this.createPrimeFigure(userId, input);
    return this.createSliceFigure(userId, input);
  }

  updateSliceFigure(userId: string, agentId: string, input: UpdateSliceFigureRequest) {
    const handler = this.kinds.get("slice-figure");
    if (!handler) throw new Error("Slice Figure handler is not registered.");
    return handler.update(userId, agentId, input);
  }

  updatePrimeFigure(userId: string, agentId: string, input: UpdatePrimeFigureRequest) {
    const handler = this.kinds.get("prime-figure");
    if (!handler) throw new Error("Prime Figure handler is not registered.");
    return handler.update(userId, agentId, input);
  }
}
