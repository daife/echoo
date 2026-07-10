export type AgentType = "prime-figure" | "slice-figure" | "prime-world";
export type CreationType = AgentType;

export interface AgentAttribute {
  key: string;
  value: string;
}

export interface AgentResourceUpload {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface SliceFigureDetail {
  prologueHtml: string;
  currentSituation: string;
  openingLine: string;
  linkedAgentIds: string[];
  unlockConditions?: Record<string, unknown>;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
}

export type PrimeFigureVariableType = "string" | "number" | "boolean" | "json";

export type PrimeFigureVariableValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface PrimeFigureVariableDefinition {
  key: string;
  label: string;
  type: PrimeFigureVariableType;
  description?: string;
  defaultValue?: PrimeFigureVariableValue;
  min?: number;
  max?: number;
  llmWritable: boolean;
}

export interface PrimeFigureMemory {
  id: string;
  content: string;
  importance: number;
  sourceMessageIds: string[];
  createdAt: number;
}

export interface PrimeFigureState {
  currentSchedule: Record<string, unknown>;
  itinerary: Record<string, unknown>;
  variables: Record<string, PrimeFigureVariableValue>;
  memories: PrimeFigureMemory[];
  mood: string;
  relationshipStatus: string;
  nextWakeupAtMs?: number;
  updatedAt: number;
}

export interface PrimeFigureDetail {
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  decisionStyle: string;
  currentSituation: string;
  schedule: Record<string, unknown>;
  itinerary: Record<string, unknown>;
  variableDefinitions: PrimeFigureVariableDefinition[];
}

export interface PrimeWorldDetail {
  status: "placeholder";
}

export type AgentDetail = SliceFigureDetail | PrimeFigureDetail | PrimeWorldDetail;

export interface AgentBase {
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
  /**
   * Persistent session id for this user's session with the figure.
   * Server-side storage currently uses conversations.id as the session id.
   */
  conversationId: string;
  createdAt: number;
  updatedAt: number;
}

export interface SliceFigureAgent extends AgentBase {
  type: "slice-figure";
  detail: SliceFigureDetail;
}

export interface PrimeFigureAgent extends AgentBase {
  type: "prime-figure";
  detail: PrimeFigureDetail;
}

export interface PrimeWorldAgent extends AgentBase {
  type: "prime-world";
  detail: PrimeWorldDetail;
}

export type Agent = SliceFigureAgent | PrimeFigureAgent | PrimeWorldAgent;

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

export interface CreatePrimeFigureRequest {
  type: "prime-figure";
  avatar?: AgentResourceUpload | null;
  cover?: AgentResourceUpload | null;
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  isPublic: boolean;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  decisionStyle?: string;
  currentSituation?: string;
  schedule?: Record<string, unknown>;
  itinerary?: Record<string, unknown>;
  variableDefinitions?: PrimeFigureVariableDefinition[];
  initialVariables?: Record<string, PrimeFigureVariableValue>;
  initialMood?: string;
  initialRelationshipStatus?: string;
}

export type UpdatePrimeFigureRequest = Omit<CreatePrimeFigureRequest, "type" | "avatar" | "cover" | "initialVariables" | "initialMood" | "initialRelationshipStatus">;

export type PrimeMessageSender = "prime_figure" | "end_user" | "system";
export type PrimeMessageDirection = "incoming" | "outgoing" | "internal";
export type PrimeMessageContentType = "text" | "image" | "video" | "voice" | "sticker" | "transfer";

export type PrimeMessageContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      description: string;
      generationPrompt?: string;
      referenceResourceUrls: string[];
      resourceUrl?: string;
    }
  | {
      type: "video";
      description: string;
      resourceUrl: string;
    }
  | {
      type: "voice";
      description: string;
      transcript: string;
      resourceUrl?: string;
    }
  | {
      type: "sticker";
      stickerId: string;
      description: string;
      resourceUrl?: string;
    }
  | {
      type: "transfer";
      note?: string;
      amount: number;
      currency: string;
      direction: "received" | "paid";
    };

export interface PrimeMessage {
  id: string;
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  sender: PrimeMessageSender;
  direction: PrimeMessageDirection;
  messageType: PrimeMessageContentType;
  content: PrimeMessageContent;
  occurredAtMs: number;
  occurredAtIso: string;
  timezone: string;
  createdAt: number;
  updatedAt: number;
}

export type PrimeFigureAction =
  | {
      type: "send_message";
      message: PrimeMessageContent;
      delayMinutes?: number;
      actionRationale: string;
    }
  | {
      type: "schedule_message";
      message: PrimeMessageContent;
      sendAtMs: number;
      actionRationale: string;
    }
  | {
      type: "update_schedule";
      patch: Record<string, unknown>;
      actionRationale: string;
    }
  | {
      type: "update_itinerary";
      patch: Record<string, unknown>;
      actionRationale: string;
    }
  | {
      type: "mutate_variable";
      key: string;
      operation: "set" | "increment" | "decrement";
      value: PrimeFigureVariableValue;
      actionRationale: string;
    }
  | {
      type: "upsert_memory";
      content: string;
      importance: number;
      sourceMessageIds: string[];
      actionRationale: string;
    }
  | {
      type: "silence";
      revisitAfterMinutes?: number;
      actionRationale: string;
    };

export interface PrimeFigureDecision {
  decisionSummary: string;
  stateAssessment: {
    userIntent: string;
    figureMood: string;
    relationshipSignal?: string;
    riskLevel: "low" | "medium" | "high";
  };
  actions: PrimeFigureAction[];
  memoryWrites: Array<{
    content: string;
    importance: number;
    sourceMessageIds: string[];
  }>;
  nextWakeupAtMs?: number;
}

export interface CreateAgentResponse {
  agent: Agent;
}
