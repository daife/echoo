import type { Agent, CreateAgentResponse, CreateSliceFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import type { ApiClient } from "./client";

export class AgentsApi {
  constructor(private readonly client: ApiClient) {}

  listMyAgents(): Promise<Agent[]> {
    return this.client.get<Agent[]>("/agents").then((agents) => agents.map((agent) => normalizeAgentResources(this.client, agent)));
  }

  createSliceFigure(body: CreateSliceFigureRequest): Promise<CreateAgentResponse> {
    return this.client
      .post<CreateAgentResponse>("/agents", body)
      .then((response) => ({ agent: normalizeAgentResources(this.client, response.agent) }));
  }

  updateSliceFigure(agentId: string, body: UpdateSliceFigureRequest): Promise<CreateAgentResponse> {
    return this.client
      .patch<CreateAgentResponse>(`/agents/${agentId}`, body)
      .then((response) => ({ agent: normalizeAgentResources(this.client, response.agent) }));
  }
}

function normalizeAgentResources(client: ApiClient, agent: Agent): Agent {
  return {
    ...agent,
    ...(agent.avatarResourcePath ? { avatarResourcePath: client.resolveServerPath(agent.avatarResourcePath) } : {}),
    ...(agent.coverResourcePath ? { coverResourcePath: client.resolveServerPath(agent.coverResourcePath) } : {})
  };
}
