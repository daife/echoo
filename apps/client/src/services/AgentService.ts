import type { AgentsApi } from "@echoo/api-client";
import type {
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
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

  updateSliceFigure(agentId: string, input: UpdateSliceFigureRequest) {
    return this.api.updateSliceFigure(agentId, input);
  }

  updatePrimeFigure(agentId: string, input: UpdatePrimeFigureRequest) {
    return this.api.updatePrimeFigure(agentId, input);
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
