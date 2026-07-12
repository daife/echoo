import type { MessageApi } from "@echoo/api-client";
import type { LocalMessage, Message } from "@echoo/shared";

/** MySQL is canonical. The client keeps only the currently visible page in React state. */
export class MessageService {
  constructor(private readonly api: MessageApi) {}
  async syncConversationMessages(conversationId: string) {
    return (await this.api.listConversationMessages(conversationId, { limit: 100 }))
      .map(toLocalMessage);
  }
  sendTextMessage(input: { conversationId: string; text: string; clientMessageId?: string; stream?: boolean }) {
    return this.api.createTextMessage(input);
  }
  ingestRealtimeMessage(_message: Message) { return Promise.resolve(); }
  ingestRealtimeCompleted(_message: Message) { return Promise.resolve(); }
  markRead(messageId: string) { return this.api.markRead(messageId, Date.now()); }
  deleteConversation(conversationId: string) { return this.api.deleteConversation(conversationId); }
  rollbackConversation(conversationId: string, messageId: string) {
    return this.api.rollbackConversation(conversationId, messageId);
  }
}

function toLocalMessage(message: Message): LocalMessage {
  return { ...message, syncStatus: "synced" };
}
