export type SyncTaskType =
  "mark_message_read" | "send_message" | "update_interface_binding";

export interface SyncTask {
  id: string;
  type: SyncTaskType;
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
}

export interface MessageSyncCursor {
  lastMessageId?: string;
  lastSyncTime?: number;
}
