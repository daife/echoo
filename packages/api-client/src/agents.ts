import type { Agent, CreateAgentResponse, CreateSliceAgentRequest } from "@echoo/shared";
import type { ApiClient } from "./client";

export class AgentsApi {
  constructor(private readonly client: ApiClient) {}

  listMyAgents(): Promise<Agent[]> {
    return this.client.get<Agent[]>("/agents");
  }

  createSliceAgent(body: CreateSliceAgentRequest): Promise<CreateAgentResponse> {
    return this.client.post<CreateAgentResponse>("/agents", body);
  }
}
