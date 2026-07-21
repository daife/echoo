import type { AgentsApi } from "@echoo/api-client";
import type {
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";

export class AgentService {
  constructor(private readonly api: AgentsApi) {}

  listMyAgents() {
    return this.api.listMyAgents();
  }

  createSliceFigure(input: CreateSliceFigureRequest) {
    return this.api.createSliceFigure(input);
  }

  createPrimeFigure(input: CreatePrimeFigureRequest) {
    return this.api.createPrimeFigure(input);
  }
  createPrimeWorld(input: CreatePrimeWorldRequest) { return this.api.createPrimeWorld(input); }

  updateSliceFigure(agentId: string, input: UpdateSliceFigureRequest) {
    return this.api.updateSliceFigure(agentId, input);
  }

  updatePrimeFigure(agentId: string, input: UpdatePrimeFigureRequest) {
    return this.api.updatePrimeFigure(agentId, input);
  }
  updatePrimeWorld(agentId: string, input: UpdatePrimeWorldRequest) { return this.api.updatePrimeWorld(agentId, input); }

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
