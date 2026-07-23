import type { AgentsApi } from "@echoo/api-client";
import type {
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
  UpdatePrimeWorldRequest,
  Agent,
} from "@echoo/shared";
import { primeWorldLocalCache } from "./primeWorldLocalCache";

export class AgentService {
  constructor(private readonly api: AgentsApi) {}

  async listMyAgents(userId?: string) {
    try {
      const agents = await this.api.listMyAgents();
      if (userId) void primeWorldLocalCache.putAgents(userId, agents);
      return agents;
    } catch (error) {
      if (!userId) throw error;
      const cached = await primeWorldLocalCache.getAgents(userId);
      if (!cached.length) throw error;
      return cached;
    }
  }

  cacheAgents(userId: string, agents: Agent[]) {
    return primeWorldLocalCache.putAgents(userId, agents);
  }

  createSliceFigure(input: CreateSliceFigureRequest) {
    return this.api.createSliceFigure(input);
  }

  createPrimeFigure(input: CreatePrimeFigureRequest) {
    return this.api.createPrimeFigure(input);
  }
  createPrimeWorld(input: CreatePrimeWorldRequest) {
    return this.api.createPrimeWorld(input);
  }

  updateSliceFigure(agentId: string, input: UpdateSliceFigureRequest) {
    return this.api.updateSliceFigure(agentId, input);
  }

  updatePrimeFigure(agentId: string, input: UpdatePrimeFigureRequest) {
    return this.api.updatePrimeFigure(agentId, input);
  }
  updatePrimeWorld(agentId: string, input: UpdatePrimeWorldRequest) {
    return this.api.updatePrimeWorld(agentId, input);
  }

  addPrimeFigureSticker(agentId: string, input: AddPrimeFigureStickerRequest) {
    return this.api.addPrimeFigureSticker(agentId, input);
  }

  deletePrimeFigureSticker(agentId: string, stickerId: string) {
    return this.api.deletePrimeFigureSticker(agentId, stickerId);
  }

  getPrimeFigureEditSnapshot(agentId: string) {
    return this.api.getPrimeFigureEditSnapshot(agentId);
  }

  exportAgent(agentId: string) {
    return this.api.exportAgent(agentId);
  }
}
