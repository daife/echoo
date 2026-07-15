import type {
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigurePreferencesRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
} from "@echoo/shared";
import { AgentKindRegistry } from "./agent-kind.registry.js";
import { AgentRepository } from "./agent.repository.js";

export class AgentsService {
  constructor(
    private readonly repository = new AgentRepository(),
    private readonly kinds = new AgentKindRegistry(),
  ) {}

  listMyAgents(userId: string) {
    return this.repository.listByOwner(userId);
  }

  getPrimeFigureEditSnapshot(userId: string, agentId: string) {
    return this.repository.getPrimeFigureEditSnapshot(userId, agentId);
  }

  exportAgent(userId: string, agentId: string) {
    return this.repository.exportAgent(userId, agentId);
  }

  createSliceFigure(userId: string, input: CreateSliceFigureRequest) {
    const handler = this.kinds.get("slice-figure");
    if (!handler) throw new Error("切片角色处理器未注册。");
    return handler.create(userId, input);
  }

  createPrimeFigure(userId: string, input: CreatePrimeFigureRequest) {
    const handler = this.kinds.get("prime-figure");
    if (!handler) throw new Error("本初角色处理器未注册。");
    return handler.create(userId, input);
  }

  createAgent(
    userId: string,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest,
  ) {
    if (input.type === "prime-figure")
      return this.createPrimeFigure(userId, input);
    return this.createSliceFigure(userId, input);
  }

  updateSliceFigure(
    userId: string,
    agentId: string,
    input: UpdateSliceFigureRequest,
  ) {
    const handler = this.kinds.get("slice-figure");
    if (!handler) throw new Error("切片角色处理器未注册。");
    return handler.update(userId, agentId, input);
  }

  updatePrimeFigure(
    userId: string,
    agentId: string,
    input: UpdatePrimeFigureRequest,
  ) {
    const handler = this.kinds.get("prime-figure");
    if (!handler) throw new Error("本初角色处理器未注册。");
    return handler.update(userId, agentId, input);
  }

  updatePrimeFigurePreferences(
    userId: string,
    agentId: string,
    input: UpdatePrimeFigurePreferencesRequest,
  ) {
    return this.repository.updatePrimeFigurePreferences(userId, agentId, input);
  }

  addPrimeFigureSticker(
    userId: string,
    agentId: string,
    input: AddPrimeFigureStickerRequest,
  ) {
    return this.repository.addPrimeFigureSticker(userId, agentId, input);
  }
}
