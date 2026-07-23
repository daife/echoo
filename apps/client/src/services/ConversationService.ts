import { ConversationsApi } from "@echoo/api-client";

export class ConversationService {
  constructor(private readonly api: ConversationsApi) {}

  listConversations() {
    return this.api.list();
  }

  markRead(conversationId: string) {
    return this.api.markRead(conversationId);
  }
}
