export type AgentType = "core" | "slice";

export interface AgentAttribute {
  key: string;
  value: string;
}

export interface AgentResourceUpload {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface Agent {
  id: string;
  ownerUserId: string;
  type: AgentType;
  avatarResourcePath?: string;
  coverResourcePath?: string;
  name: string;
  attributes: AgentAttribute[];
  tags: string[];
  introduction: string;
  isPublic: boolean;
  linkedAgentIds: string[];
  unlockConditions?: Record<string, unknown>;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSliceAgentRequest {
  type: "slice";
  avatar?: AgentResourceUpload | null;
  cover?: AgentResourceUpload | null;
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  isPublic: boolean;
  linkedAgentIds?: string[];
  unlockConditions?: Record<string, unknown> | null;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
}

export interface CreateAgentResponse {
  agent: Agent;
}
