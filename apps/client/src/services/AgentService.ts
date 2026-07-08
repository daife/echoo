import type { AgentsApi } from "@echoo/api-client";
import type { CreateSliceAgentRequest } from "@echoo/shared";

export class AgentService {
  constructor(private readonly api: AgentsApi) {}

  listMyAgents() {
    return this.api.listMyAgents();
  }

  createSliceAgent(input: CreateSliceAgentRequest) {
    return this.api.createSliceAgent(input);
  }
}
