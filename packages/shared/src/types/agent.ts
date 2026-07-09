export type AgentType = "prime-figure" | "slice-figure";

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
  prologueHtml: string;
  currentSituation: string;
  openingLine: string;
  isPublic: boolean;
  linkedAgentIds: string[];
  unlockConditions?: Record<string, unknown>;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  /**
   * Persistent session id for this user's session with the figure.
   * Server-side storage currently uses conversations.id as the session id.
   */
  conversationId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSliceFigureRequest {
  type: "slice-figure";
  avatar?: AgentResourceUpload | null;
  cover?: AgentResourceUpload | null;
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  prologueHtml?: string;
  currentSituation?: string;
  openingLine?: string;
  isPublic: boolean;
  linkedAgentIds?: string[];
  unlockConditions?: Record<string, unknown> | null;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
}

export type UpdateSliceFigureRequest = Omit<CreateSliceFigureRequest, "type" | "avatar" | "cover">;

export interface CreateAgentResponse {
  agent: Agent;
}
