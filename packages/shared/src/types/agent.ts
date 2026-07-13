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

export interface PrimeFigureReferenceImage {
  resourceId: string;
  resourcePath: string;
  description: string;
}

export type PrimeFigureReferenceImageInput =
  | {
      resourceId: string;
      description: string;
      upload?: never;
    }
  | {
      upload: AgentResourceUpload;
      description: string;
      resourceId?: never;
    };

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
  systemPrompt: string;
  memorySummaryPrompt: string;
  replyAutoSegment: boolean;
}

export type PrimeFigureVariableType = "string" | "number" | "boolean" | "json";

export type PrimeFigureVariableValue =
  string | number | boolean | null | Record<string, unknown> | unknown[];

export interface PrimeFigureVariableDefinition {
  key: string;
  label: string;
  type: PrimeFigureVariableType;
  description: string;
  defaultValue?: PrimeFigureVariableValue;
  min?: number;
  max?: number;
}

export interface PrimeFigureMemory {
  id: string;
  content: string;
  eventAtMs: number;
  recordedAtMs: number;
}

export type PrimeFigureWeekday =
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PrimeFigureScheduleSegment {
  label: string;
  days: PrimeFigureWeekday[];
  start: string;
  end: string;
  description: string;
}

export interface PrimeFigureSchedule {
  segments: PrimeFigureScheduleSegment[];
}

export interface PrimeFigureState {
  variables: Record<string, PrimeFigureVariableValue>;
  memories: PrimeFigureMemory[];
  mood: string;
  moodObservedAtMs: number;
  relationshipStatus: string;
  silenceStartedAtMs?: number;
  silenceUntilMs?: number;
  updatedAt: number;
}

export interface PrimeFigureDetail {
  prologueHtml: string;
  linkedAgentIds: string[];
  unlockConditions?: Record<string, unknown>;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  decisionStyle: string;
  currentSituation: string;
  schedule: PrimeFigureSchedule;
  itinerary: string;
  variableDefinitions: PrimeFigureVariableDefinition[];
  referenceImages: PrimeFigureReferenceImage[];
}

export interface PrimeWorldDetail {
  status: "placeholder";
}

export type AgentDetail =
  SliceFigureDetail | PrimeFigureDetail | PrimeWorldDetail;

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
  /** Public runtime presence projection; omitted when the figure is not muted. */
  muteUntilMs?: number;
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
  systemPrompt: string;
  memorySummaryPrompt: string;
  replyAutoSegment?: boolean;
}

export type UpdateSliceFigureRequest = Omit<
  CreateSliceFigureRequest,
  "type"
>;

export interface CreatePrimeFigureRequest {
  type: "prime-figure";
  avatar?: AgentResourceUpload | null;
  cover?: AgentResourceUpload | null;
  name: string;
  attributes?: AgentAttribute[];
  tags?: string[];
  introduction?: string;
  prologueHtml?: string;
  linkedAgentIds?: string[];
  unlockConditions?: Record<string, unknown> | null;
  isPublic: boolean;
  persona: string;
  background: string;
  personality: string;
  responseStyle: string;
  decisionStyle?: string;
  currentSituation?: string;
  schedule?: PrimeFigureSchedule;
  itinerary?: string;
  variableDefinitions?: PrimeFigureVariableDefinition[];
  referenceImages?: PrimeFigureReferenceImageInput[];
  initialMood?: string;
  initialRelationshipStatus?: string;
}

export type UpdatePrimeFigureRequest = Omit<
  CreatePrimeFigureRequest,
  "type" | "initialMood" | "initialRelationshipStatus"
> & {
  currentVariables: Record<string, PrimeFigureVariableValue>;
  currentMood: string;
  currentRelationshipStatus: string;
};

export interface PrimeFigureEditSnapshot {
  agent: PrimeFigureAgent;
  state: Pick<
    PrimeFigureState,
    "variables" | "mood" | "relationshipStatus"
  >;
}

export interface AgentExportResponse {
  data: CreateSliceFigureRequest | CreatePrimeFigureRequest;
}

export type PrimeMessageSender = "prime_figure" | "end_user";
export type PrimeMessageContentType =
  "text" | "image" | "video" | "voice" | "sticker" | "transfer";

export type PrimeMessageContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      description?: string;
      generationPrompt?: string;
      referenceResourceUrls: string[];
      referenceMediaIds?: string[];
      resourceId?: string;
      resourceUrl?: string;
    }
  | {
      type: "video";
      description?: string;
      resourceId?: string;
      resourceUrl?: string;
    }
  | {
      type: "voice";
      description?: string;
      transcript?: string;
      resourceId?: string;
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
  /** Canonical per-database timeline order. */
  sequence?: number;
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  sender: PrimeMessageSender;
  messageType: PrimeMessageContentType;
  content: PrimeMessageContent;
  occurredAtMs: number;
  occurredAtIso: string;
  createdAt: number;
  updatedAt: number;
}

export type PrimeMediaAnnotation =
  | {
      id: string;
      type: "image" | "video";
      description: string;
    }
  | {
      id: string;
      type: "voice";
      transcript: string;
    };

export type PrimeFigureOutgoingMessage =
  | Extract<PrimeMessageContent, { type: "text" }>
  | {
      type: "image";
      description: string;
      generationPrompt: string;
      referenceMediaIds: string[];
    }
  | {
      type: "voice";
      transcript: string;
    };

export type PrimeFigureAction =
  | {
      type: "send_message";
      message: PrimeFigureOutgoingMessage;
    }
  | {
      type: "silence";
    }
  | {
      type: "mute";
      revisitAfterMinutes: number;
    };

export interface PrimeFigureStateUpdates {
  currentSituation?: string | null;
  schedule?: PrimeFigureSchedule | null;
  itinerary?: string | null;
  relationshipStatus?: string | null;
}

export interface PrimeFigureDecision {
  rationale: string;
  figureMood: string;
  variables: Record<string, PrimeFigureVariableValue>;
  memoryWrites?: Array<{
    content: string;
    eventAt: string | null;
  }>;
  stateUpdates?: PrimeFigureStateUpdates;
  actions:
    | [
        Extract<PrimeFigureAction, { type: "send_message" }>,
        ...Array<Extract<PrimeFigureAction, { type: "send_message" }>>,
      ]
    | [Extract<PrimeFigureAction, { type: "silence" }>]
    | [Extract<PrimeFigureAction, { type: "mute" }>];
}

export interface CreateAgentResponse {
  agent: Agent;
}
