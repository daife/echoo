import type { LocalMessage, SyncTask } from "@echoo/shared";

export interface StorageRuntime {
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
  removeSetting(key: string): Promise<void>;
  saveMessage(message: LocalMessage): Promise<void>;
  saveMessages(messages: LocalMessage[]): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  deleteConversationMessages(conversationId: string): Promise<void>;
  deleteConversationMessagesAfter(conversationId: string, retainedThroughMessageId: string): Promise<void>;
  getMessage(id: string): Promise<LocalMessage | null>;
  listMessages(options?: { limit?: number; before?: number; unreadOnly?: boolean; conversationId?: string }): Promise<LocalMessage[]>;
  markMessageRead(id: string, readAt: number): Promise<void>;
  getSyncState(key: string): Promise<string | null>;
  setSyncState(key: string, value: string): Promise<void>;
  enqueueSyncTask(task: SyncTask): Promise<void>;
  listPendingSyncTasks(): Promise<SyncTask[]>;
  markSyncTaskDone(taskId: string): Promise<void>;
}
