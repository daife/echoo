import type { MessageApi } from "@echoo/api-client";
import { createMarkReadTask, nextMessageCursor } from "@echoo/domain";
import { SYNC_KEYS, type LocalMessage, type Message } from "@echoo/shared";
import type { MessageDeltaEvent, StorageRuntime } from "../runtimes/contracts";

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

  async syncConversationMessages(conversationId: string) {
    const messages = await this.api.listConversationMessages(conversationId);
    await this.saveSyncedMessages(messages);
    return messages;
  }

  async sendTextMessage(input: { conversationId: string; text: string; clientMessageId?: string; stream?: boolean }) {
    const clientMessageId = input.clientMessageId ?? `client_${crypto.randomUUID()}`;
    const pending: LocalMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId: input.conversationId,
      senderId: "me",
      role: "user",
      direction: "outgoing",
      contentType: "text",
      content: { text: input.text },
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "pending"
    };

    await this.storage.saveMessage(pending);

    try {
      const result = await this.api.createTextMessage({
        conversationId: input.conversationId,
        text: input.text,
        clientMessageId,
        stream: input.stream
      });
      await this.storage.deleteMessage(pending.id);
      await this.storage.saveMessage({ ...result.message, syncStatus: "synced" });
      if (result.assistantMessage) {
        const currentAssistantMessage = await this.storage.getMessage(result.assistantMessage.id);
        if (!currentAssistantMessage || currentAssistantMessage.status === "pending") {
          await this.storage.saveMessage({
            ...result.assistantMessage,
            content: {
              ...result.assistantMessage.content,
              text: currentAssistantMessage?.content.text || result.assistantMessage.content.text
            },
            updatedAt: Math.max(currentAssistantMessage?.updatedAt ?? 0, result.assistantMessage.updatedAt),
            syncStatus: "synced"
          });
        }
      }
      return result;
    } catch (error) {
      await this.storage.saveMessage({
        ...pending,
        status: "failed",
        syncStatus: "failed",
        updatedAt: Date.now(),
        error: { message: error instanceof Error ? error.message : "Message send failed." }
      });
      throw error;
    }
  }

  async ingestRealtimeMessage(message: Message) {
    await this.storage.saveMessage({ ...message, syncStatus: "synced" });
  }

  async ingestRealtimeDelta(event: MessageDeltaEvent) {
    const message = await this.storage.getMessage(event.messageId);
    if (!message) return;

    await this.storage.saveMessage({
      ...message,
      content: {
        ...message.content,
        text: `${message.content.text ?? ""}${event.delta}`
      },
      status: "pending",
      updatedAt: event.updatedAt,
      syncStatus: "synced"
    });
  }

  async ingestRealtimeCompleted(message: Message) {
    await this.storage.saveMessage({ ...message, syncStatus: "synced" });
  }

  async markRead(messageId: string) {
    const readAt = Date.now();
    await this.storage.markMessageRead(messageId, readAt);
    await this.storage.enqueueSyncTask(createMarkReadTask(messageId, readAt));
  }

  async listLocalMessages(conversationId?: string): Promise<LocalMessage[]> {
    return this.storage.listMessages({ limit: 100, conversationId });
  }

  private async saveSyncedMessages(messages: Message[]) {
    await this.storage.saveMessages(messages.map((message) => ({ ...message, syncStatus: "synced" as const })));
  }
}
