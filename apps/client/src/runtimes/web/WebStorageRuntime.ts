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

  async getMessage(id: string): Promise<LocalMessage | null> {
    const db = await getEchooDb();
    return (await db.get("messages", id)) ?? null;
  }

  async listMessages(options?: { limit?: number; before?: number; unreadOnly?: boolean; conversationId?: string }): Promise<LocalMessage[]> {
    const db = await getEchooDb();
    const messages = await db.getAll("messages");
    return messages
      .filter((message) => (options?.conversationId ? message.conversationId === options.conversationId : true))
      .filter((message) => (options?.before ? message.createdAt < options.before : true))
      .filter((message) => (options?.unreadOnly ? message.status !== "read" : true))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-(options?.limit ?? 100));
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
