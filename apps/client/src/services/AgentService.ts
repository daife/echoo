import type { AgentsApi } from "@echoo/api-client";
import type { CreateSliceFigureRequest } from "@echoo/shared";

export class AgentService {
  constructor(private readonly api: AgentsApi) {}

  listMyAgents() {
    return this.api.listMyAgents();
  }

  createSliceFigure(input: CreateSliceFigureRequest) {
    return this.api.createSliceFigure(input);
  }
}
