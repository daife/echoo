import type {
  AddPrimeFigureStickerRequest,
  Agent,
  AgentExportResponse,
  CreateAgentResponse,
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  PrimeFigureEditSnapshot,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class AgentsApi {
  constructor(private readonly client: ApiClient) {}

  listMyAgents(): Promise<Agent[]> {
    return this.client
      .get<Agent[]>("/agents")
      .then((agents) =>
        agents.map((agent) => normalizeAgentResources(this.client, agent)),
      );
  }

  createSliceFigure(
    body: CreateSliceFigureRequest,
  ): Promise<CreateAgentResponse> {
    return this.client
      .post<CreateAgentResponse>("/agents", body)
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  createPrimeFigure(
    body: CreatePrimeFigureRequest,
  ): Promise<CreateAgentResponse> {
    return this.client
      .post<CreateAgentResponse>("/agents", body)
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  createPrimeWorld(body: CreatePrimeWorldRequest): Promise<CreateAgentResponse> {
    return this.client.post<CreateAgentResponse>("/agents", body).then((response) => ({ agent: normalizeAgentResources(this.client, response.agent) }));
  }

  updateSliceFigure(
    agentId: string,
    body: UpdateSliceFigureRequest,
  ): Promise<CreateAgentResponse> {
    return this.client
      .patch<CreateAgentResponse>(`/agents/${agentId}`, body)
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  updatePrimeFigure(
    agentId: string,
    body: UpdatePrimeFigureRequest,
  ): Promise<CreateAgentResponse> {
    return this.client
      .patch<CreateAgentResponse>(`/agents/${agentId}/prime-figure`, body)
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  updatePrimeWorld(agentId: string, body: UpdatePrimeWorldRequest): Promise<CreateAgentResponse> {
    return this.client.patch<CreateAgentResponse>(`/agents/${agentId}/prime-world`, body).then((response) => ({ agent: normalizeAgentResources(this.client, response.agent) }));
  }

  addPrimeFigureSticker(
    agentId: string,
    body: AddPrimeFigureStickerRequest,
  ): Promise<CreateAgentResponse> {
    return this.client
      .post<CreateAgentResponse>(
        `/agents/${agentId}/prime-figure/stickers`,
        body,
      )
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  deletePrimeFigureSticker(
    agentId: string,
    stickerId: string,
  ): Promise<CreateAgentResponse> {
    return this.client
      .delete<CreateAgentResponse>(
        `/agents/${agentId}/prime-figure/stickers/${stickerId}`,
      )
      .then((response) => ({
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  getPrimeFigureEditSnapshot(
    agentId: string,
  ): Promise<PrimeFigureEditSnapshot> {
    return this.client
      .get<PrimeFigureEditSnapshot>(`/agents/${agentId}/prime-figure/edit`)
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent) as Extract<
          Agent,
          { type: "prime-figure" }
        >,
      }));
  }

  exportAgent(agentId: string): Promise<AgentExportResponse> {
    return this.client.get<AgentExportResponse>(`/agents/${agentId}/export`);
  }
}

export function normalizeAgentResources(
  client: ApiClient,
  agent: Agent,
): Agent {
  const normalized = {
    ...agent,
    ...(agent.avatarResourcePath
      ? {
          avatarResourcePath: client.resolveServerPath(
            agent.avatarResourcePath,
          ),
        }
      : {}),
    ...(agent.coverResourcePath
      ? { coverResourcePath: client.resolveServerPath(agent.coverResourcePath) }
      : {}),
  };
  if (agent.type !== "prime-figure") return normalized as Agent;
  return {
    ...normalized,
    type: "prime-figure",
    detail: {
      ...agent.detail,
      referenceImages: agent.detail.referenceImages.map((item) => ({
        ...item,
        resourcePath:
          client.resolveServerPath(item.resourcePath) ?? item.resourcePath,
      })),
      stickers: (agent.detail.stickers ?? []).map((item) => ({
        ...item,
        resourcePath:
          client.resolveServerPath(item.resourcePath) ?? item.resourcePath,
      })),
    },
  } as Agent;
}
