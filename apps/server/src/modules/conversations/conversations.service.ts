import { ConversationRepository } from "./conversation.repository.js";

export class ConversationsService {
  constructor(private readonly repository = new ConversationRepository()) {}

  listConversations() {
    return this.repository.list();
  }
}
