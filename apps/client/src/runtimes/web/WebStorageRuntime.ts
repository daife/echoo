import type { LocalMessage, SyncTask } from "@echoo/shared";
import type { StorageRuntime } from "../contracts";
import { getEchooDb } from "../../infra/storage/indexeddb/db";

export class WebStorageRuntime implements StorageRuntime {
  async getSetting<T>(key: string): Promise<T | null> {
    const value = localStorage.getItem(`echoo.setting.${key}`);
    return value ? (JSON.parse(value) as T) : null;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(`echoo.setting.${key}`, JSON.stringify(value));
  }

  async removeSetting(key: string): Promise<void> {
    localStorage.removeItem(`echoo.setting.${key}`);
  }

  async saveMessage(message: LocalMessage): Promise<void> {
    const db = await getEchooDb();
    await db.put("messages", message);
  }

  async saveMessages(messages: LocalMessage[]): Promise<void> {
    const db = await getEchooDb();
    const tx = db.transaction("messages", "readwrite");
    await Promise.all(messages.map((message) => tx.store.put(message)));
    await tx.done;
  }

  async deleteMessage(id: string): Promise<void> {
    const db = await getEchooDb();
    await db.delete("messages", id);
  }

  async deleteConversationMessages(conversationId: string): Promise<void> {
    const db = await getEchooDb();
    const tx = db.transaction("messages", "readwrite");
    let cursor = await tx.store.index("by-conversation").openCursor(conversationId);

    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
  }

  async deleteConversationMessagesAfter(conversationId: string, retainedThroughMessageId: string): Promise<void> {
    const messages = await this.listMessages({ conversationId, limit: Number.MAX_SAFE_INTEGER });
    const retainedThroughIndex = messages.findIndex((message) => message.id === retainedThroughMessageId);
    if (retainedThroughIndex < 0) return;

    const deleteIds = messages.slice(retainedThroughIndex + 1).map((message) => message.id);

    const db = await getEchooDb();
    const tx = db.transaction("messages", "readwrite");
    await Promise.all(deleteIds.map((id) => tx.store.delete(id)));
    await tx.done;
  }

  async getMessage(id: string): Promise<LocalMessage | null> {
    const db = await getEchooDb();
    return (await db.get("messages", id)) ?? null;
  }

  async listMessages(options?: { limit?: number; before?: number; unreadOnly?: boolean; conversationId?: string }): Promise<LocalMessage[]> {
    const db = await getEchooDb();
    const limit = Math.max(1, options?.limit ?? 100);
    const messages: LocalMessage[] = [];
    const source = options?.conversationId
      ? db.transaction("messages").store.index("by-conversation-created-at")
      : db.transaction("messages").store.index("by-created-at");
    const range = options?.conversationId
      ? IDBKeyRange.bound(
          [options.conversationId, 0],
          [options.conversationId, options.before ?? Number.MAX_SAFE_INTEGER],
          false,
          Boolean(options.before)
        )
      : options?.before
        ? IDBKeyRange.upperBound(options.before, true)
        : undefined;

    let cursor = await source.openCursor(range, "prev");
    while (cursor && messages.length < limit) {
      const message = cursor.value;
      if (!options?.unreadOnly || message.status !== "read") {
        messages.push(message);
      }
      cursor = await cursor.continue();
    }

    return messages.reverse();
  }

  async markMessageRead(id: string, readAt: number): Promise<void> {
    const message = await this.getMessage(id);
    if (!message) return;
    await this.saveMessage({ ...message, status: "read", readAt, updatedAt: readAt });
  }

  async getSyncState(key: string): Promise<string | null> {
    return localStorage.getItem(`echoo.sync.${key}`);
  }

  async setSyncState(key: string, value: string): Promise<void> {
    localStorage.setItem(`echoo.sync.${key}`, value);
  }

  async enqueueSyncTask(task: SyncTask): Promise<void> {
    const db = await getEchooDb();
    await db.put("syncTasks", task);
  }

  async listPendingSyncTasks(): Promise<SyncTask[]> {
    const db = await getEchooDb();
    return db.getAll("syncTasks");
  }

  async markSyncTaskDone(taskId: string): Promise<void> {
    const db = await getEchooDb();
    await db.delete("syncTasks", taskId);
  }
}
