import { randomUUID } from "node:crypto";
import type { Message } from "@echoo/shared";
import { AgentRuntimeService } from "../agents/agent-runtime.service.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { AppPushService } from "../realtime/delivery.service.js";
import { MessageRepository } from "./message.repository.js";

export interface CreateUserTextMessageInput {
  ownerUserId: string;
  conversationId: string;
  text: string;
  clientMessageId?: string | null;
}

export interface CreateUserTextMessageResult {
  message: Message;
  assistantMessage?: Message;
}

export class MessagingService {
  constructor(
    private readonly repository = new MessageRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    private readonly agentRuntime = new AgentRuntimeService()
  ) {}

  listMessages(ownerUserId: string, after?: string | null, conversationId?: string | null) {
    return this.repository.listAfter(ownerUserId, after, conversationId);
  }

  listConversationMessages(ownerUserId: string, conversationId: string) {
    if (!this.conversations.findByIdForOwner(ownerUserId, conversationId)) return null;
    return this.repository.listByConversation(ownerUserId, conversationId);
  }

  async createUserTextMessage(input: CreateUserTextMessageInput): Promise<CreateUserTextMessageResult | null> {
    const conversation = this.conversations.findByIdForOwner(input.ownerUserId, input.conversationId);
    if (!conversation) return null;

    const existing = this.repository.findByClientMessageId(input.ownerUserId, input.clientMessageId);
    if (existing) return { message: existing };

    const now = Date.now();
    const message = this.repository.save({
      ownerUserId: input.ownerUserId,
      id: `msg_${randomUUID()}`,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      conversationId: input.conversationId,
      senderId: input.ownerUserId,
      role: "user",
      direction: "outgoing",
      contentType: "text",
      content: { text: input.text },
      status: "sent",
      createdAt: now,
      updatedAt: now
    });

    this.conversations.updatePreview({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      preview: input.text,
      updatedAt: now
    });
    this.appPush.pushToUser(input.ownerUserId, { type: "message.created", message });

    if (!conversation.agentId) return { message };

    const assistantMessage = await this.createAssistantReply(input.ownerUserId, input.conversationId, conversation.agentId);
    return { message, assistantMessage };
  }

  markRead(ownerUserId: string, messageId: string, readAt: number) {
    const updated = this.repository.markRead(ownerUserId, messageId, readAt);
    if (updated) {
      this.appPush.pushToUser(ownerUserId, {
        type: "message.status_changed",
        messageId,
        status: "read",
        updatedAt: readAt
      });
    }
    return updated;
  }

  private async createAssistantReply(ownerUserId: string, conversationId: string, agentId: string) {
    const now = Date.now();

    try {
      const reply = await this.agentRuntime.createReply({ ownerUserId, conversationId });
      if (!reply) return undefined;

      const message = this.repository.save({
        ownerUserId,
        id: `msg_${randomUUID()}`,
        conversationId,
        senderId: agentId,
        role: "assistant",
        direction: "incoming",
        contentType: "text",
        content: { text: reply.text },
        status: "delivered",
        providerId: reply.providerId,
        model: reply.model,
        metadata: reply.raw ? { raw: reply.raw } : undefined,
        createdAt: now,
        updatedAt: now
      });

      this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: reply.text,
        updatedAt: now,
        incrementUnread: true
      });
      this.appPush.pushToUser(ownerUserId, { type: "message.created", message });
      return message;
    } catch (error) {
      const message = this.repository.save({
        ownerUserId,
        id: `msg_${randomUUID()}`,
        conversationId,
        senderId: agentId,
        role: "assistant",
        direction: "incoming",
        contentType: "text",
        content: { text: "AI reply is temporarily unavailable. Check the server provider configuration and try again." },
        status: "failed",
        metadata: { kind: "ai_error" },
        error: {
          message: error instanceof Error ? error.message : "Unknown AI provider error"
        },
        createdAt: now,
        updatedAt: now
      });

      this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: "AI reply failed.",
        updatedAt: now,
        incrementUnread: true
      });
      this.appPush.pushToUser(ownerUserId, { type: "message.created", message });
      return message;
    }
  }
}
