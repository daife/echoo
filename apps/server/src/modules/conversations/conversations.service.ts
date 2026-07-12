import { ConversationRepository } from "./conversation.repository.js";
import { MessageCache } from "../../infra/redis/message-cache.js";

export class ConversationsService {
  constructor(
    private readonly repository = new ConversationRepository(),
    private readonly messageCache = new MessageCache(),
  ) {}

  listConversations(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId);
  }

  async deleteConversation(ownerUserId: string, conversationId: string) {
    if (!(await this.repository.findByIdForOwner(ownerUserId, conversationId))) return false;
    const deleted = await this.repository.deleteForOwner(ownerUserId, conversationId);
    if (deleted) {
      try {
        await this.messageCache.invalidate(ownerUserId, conversationId);
      } catch (error) {
        console.warn("Deleted conversation cache invalidation failed.", error);
      }
    }
    return deleted;
  }
}
