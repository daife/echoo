import type { MessageApi } from "@echoo/api-client";
import type { LocalMessage, Message } from "@echoo/shared";

/** MySQL is canonical. The client keeps only the currently visible page in React state. */
export class MessageService {
  constructor(private readonly api: MessageApi) {}
  async loadLatestConversationMessages(conversationId: string, limit = 50) {
    return (
      await this.api.listConversationMessages(conversationId, { limit })
    ).map(toLocalMessage);
  }
  async loadOlderConversationMessages(
    conversationId: string,
    before: string,
    limit = 50,
  ) {
    return (
      await this.api.listConversationMessages(conversationId, { before, limit })
    ).map(toLocalMessage);
  }
  sendTextMessage(input: {
    conversationId: string;
    text: string;
    clientMessageId?: string;
    stream?: boolean;
  }) {
    return this.api.createTextMessage(input);
  }
  ingestRealtimeMessage(_message: Message) {
    return Promise.resolve();
  }
  ingestRealtimeCompleted(_message: Message) {
    return Promise.resolve();
  }
  markRead(messageId: string) {
    return this.api.markRead(messageId, Date.now());
  }
  deleteConversation(conversationId: string) {
    return this.api.deleteConversation(conversationId);
  }
  rollbackConversation(conversationId: string, messageId: string) {
    return this.api.rollbackConversation(conversationId, messageId);
  }
}

function toLocalMessage(message: Message): LocalMessage {
  return { ...message, syncStatus: "synced" };
}
