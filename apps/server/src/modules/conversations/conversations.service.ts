import { ConversationRepository } from "./conversation.repository.js";
import { MessageCache } from "../../infra/redis/message-cache.js";
import { AgentRunQueue } from "../../infra/redis/run-queue.js";

export class ConversationsService {
  constructor(
    private readonly repository = new ConversationRepository(),
    private readonly messageCache = new MessageCache(),
    private readonly runQueue = new AgentRunQueue(),
  ) {}

  listConversations(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId);
  }

  markRead(ownerUserId: string, conversationId: string) {
    return this.repository.markRead(ownerUserId, conversationId);
  }

  async deleteConversation(ownerUserId: string, conversationId: string) {
    if (!(await this.repository.findByIdForOwner(ownerUserId, conversationId)))
      return false;
    const deleted = await this.repository.deleteForOwner(
      ownerUserId,
      conversationId,
    );
    if (deleted) {
      const cleanupResults = await Promise.allSettled([
        this.messageCache.invalidate(ownerUserId, conversationId),
        this.runQueue.cancelConversation(conversationId),
      ]);
      for (const result of cleanupResults) {
        if (result.status === "rejected") {
          console.warn(
            "Deleted conversation Redis cleanup failed.",
            result.reason,
          );
        }
      }
    }
    return deleted;
  }
}
