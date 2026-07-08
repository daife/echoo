export type AgentType = "core" | "slice";

export interface Agent {
  id: string;
  ownerUserId: string;
  type: AgentType;
  name: string;
  persona: string;
  background: string;
  personality: string;
  speechStyle: string;
  openingLine: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSliceAgentRequest {
  type: "slice";
  name: string;
  persona: string;
  background: string;
  personality: string;
  speechStyle: string;
  openingLine: string;
}

export interface CreateAgentResponse {
  agent: Agent;
}
