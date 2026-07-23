import type { Agent } from "./agent.js";
import type { PublicAssetDraft } from "../domains/public-assets/types.js";
import type { MediaResourceStatus, Message } from "./message.js";
import type { Conversation } from "./conversation.js";
import type { NotificationState } from "../domains/notifications/types.js";

export type SyncCursor = number;
export type SyncEntityType =
  | "agent"
  | "message"
  | "resource"
  | "asset"
  | "conversation"
  | "notification-state";
export type SyncOperation = "upsert" | "delete";

export type SyncEntity =
  | { entityType: "agent"; value: Agent }
  | { entityType: "message"; value: Message }
  | { entityType: "resource"; value: MediaResourceStatus }
  | { entityType: "asset"; value: PublicAssetDraft }
  | { entityType: "conversation"; value: Conversation }
  | { entityType: "notification-state"; value: NotificationState };

export interface SyncChange {
  cursor: SyncCursor;
  entityType: SyncEntityType;
  entityId: string;
  conversationId?: string;
  operation: SyncOperation;
  entity?: SyncEntity;
  createdAt: number;
}

export interface SyncPage {
  cursor: SyncCursor;
  headCursor: SyncCursor;
  hasMore: boolean;
  resetRequired: boolean;
  changes: SyncChange[];
}

export interface SyncBootstrap {
  cursor: SyncCursor;
  agents: Agent[];
  assets: PublicAssetDraft[];
  conversations: Conversation[];
  notificationState: NotificationState;
}
