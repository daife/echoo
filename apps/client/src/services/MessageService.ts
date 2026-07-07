import type { MessageApi } from "@echoo/api-client";
import { createMarkReadTask, nextMessageCursor } from "@echoo/domain";
import { SYNC_KEYS, type LocalMessage } from "@echoo/shared";
import type { StorageRuntime } from "../runtimes/contracts";

export class MessageService {
  constructor(
    private readonly api: MessageApi,
    private readonly storage: StorageRuntime
  ) {}

  async syncMessages() {
    const lastId = await this.storage.getSyncState(SYNC_KEYS.lastMessageId);
    const messages = await this.api.listMessages({ after: lastId });

    await this.storage.saveMessages(messages.map((message) => ({ ...message, syncStatus: "synced" as const })));

    const nextCursor = nextMessageCursor(messages);
    if (nextCursor) {
      await this.storage.setSyncState(SYNC_KEYS.lastMessageId, nextCursor);
    }

    return messages;
  }

  async markRead(messageId: string) {
    const readAt = Date.now();
    await this.storage.markMessageRead(messageId, readAt);
    await this.storage.enqueueSyncTask(createMarkReadTask(messageId, readAt));
  }

  async listLocalMessages(): Promise<LocalMessage[]> {
    return this.storage.listMessages({ limit: 100 });
  }
}
