import { ConversationRepository } from "./conversation.repository.js";

export class ConversationsService {
  constructor(private readonly repository = new ConversationRepository()) {}

  listConversations(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId);
  }
}
