import { ConversationRepository } from "./conversation.repository.js";

export class ConversationsService {
  constructor(private readonly repository = new ConversationRepository()) {}

  listConversations(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId);
  }

  deleteConversation(ownerUserId: string, conversationId: string) {
    if (!this.repository.findByIdForOwner(ownerUserId, conversationId)) return false;
    return this.repository.deleteForOwner(ownerUserId, conversationId);
  }
}
