import type { MessageApi } from "@echoo/api-client";
import type {
  CreateMediaMessageInput,
  LocalMessage,
  Message,
} from "@echoo/shared";

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
  }) {
    return this.api.createTextMessage(input);
  }
  sendMediaMessage(input: CreateMediaMessageInput) {
    return this.api.createMediaMessage(input);
  }
  resolveTransfer(input: import("@echoo/shared").ResolveTransferInput) {
    return this.api.resolveTransfer(input);
  }
  triggerPrimeFigureHint(conversationId: string, instruction: string) {
    return this.api.triggerPrimeFigureHint(conversationId, instruction);
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
  updateAssistantMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ) {
    return this.api.updateAssistantMessage(conversationId, messageId, text);
  }
}

function toLocalMessage(message: Message): LocalMessage {
  return { ...message, syncStatus: "synced" };
}
