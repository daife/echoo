import { randomUUID } from "node:crypto";
import type { Message } from "@echoo/shared";
import { AgentRuntimeService } from "../agents/agent-runtime.service.js";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { PrimeMessageRepository } from "../agents/kinds/prime-figure/prime-message.repository.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { AppPushService } from "../realtime/delivery.service.js";
import { MessageRepository } from "./message.repository.js";

export interface CreateUserTextMessageInput {
  ownerUserId: string;
  conversationId: string;
  text: string;
  clientMessageId?: string | null;
  stream?: boolean;
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
    private readonly agentRuntime = new AgentRuntimeService(),
    private readonly primeMessages = new PrimeMessageRepository(),
    private readonly primeRuntime = new PrimeFigureRuntimeService()
  ) {}

  listMessages(ownerUserId: string, after?: string | null, conversationId?: string | null, limit?: number) {
    return this.repository.listAfter(ownerUserId, after, conversationId, limit);
  }

  listConversationMessages(
    ownerUserId: string,
    conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number }
  ) {
    if (!this.conversations.findByIdForOwner(ownerUserId, conversationId)) return null;
    return this.repository.listByConversation(ownerUserId, conversationId, options);
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
      role: "user",
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

    if (conversation.type === "prime-figure") {
      this.primeMessages.save({
        ownerUserId: input.ownerUserId,
        agentId: conversation.agentId,
        conversationId: input.conversationId,
        sender: "end_user",
        direction: "incoming",
        content: { type: "text", text: input.text },
        occurredAtMs: now,
        timezone: process.env.TZ ?? "UTC"
      });
      void this.primeRuntime.createDecision({ ownerUserId: input.ownerUserId, conversationId: input.conversationId });
      return { message };
    }

    if (input.stream === false) {
      const assistantMessage = await this.createAssistantReply(input.ownerUserId, input.conversationId);
      return { message, assistantMessage };
    }

    const assistantMessage = this.createAssistantPlaceholder(input.ownerUserId, input.conversationId);
    this.appPush.pushToUser(input.ownerUserId, { type: "message.created", message: assistantMessage });
    void this.streamAssistantReply(input.ownerUserId, input.conversationId, assistantMessage);

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

  rollbackConversation(ownerUserId: string, conversationId: string, messageId: string) {
    const conversation = this.conversations.findByIdForOwner(ownerUserId, conversationId);
    if (!conversation) return { kind: "not_found" as const };
    if (conversation.type !== "slice-figure") return { kind: "unsupported_type" as const };

    const anchor = this.repository.findByIdInConversation(ownerUserId, conversationId, messageId);
    if (!anchor) return { kind: "message_not_found" as const };

    const retainedThrough =
      anchor.role === "user" ? this.repository.findNextAssistantMessage(ownerUserId, conversationId, anchor) ?? anchor : anchor;
    const deletedCount = this.repository.deleteAfterMessage(ownerUserId, conversationId, retainedThrough);
    const lastMessage = this.repository.findLastByConversation(ownerUserId, conversationId);
    const now = Date.now();

    this.conversations.updatePreview({
      ownerUserId,
      conversationId,
      preview: lastMessage?.content.text ?? null,
      updatedAt: now
    });

    return {
      kind: "ok" as const,
      retainedThroughMessageId: retainedThrough.id,
      deletedCount
    };
  }

  private createAssistantPlaceholder(ownerUserId: string, conversationId: string) {
    const now = Date.now();

    return this.repository.save({
      ownerUserId,
      id: `msg_${randomUUID()}`,
      conversationId,
      role: "assistant",
      contentType: "text",
      content: { text: "" },
      status: "pending",
      createdAt: now,
      updatedAt: now
    });
  }

  private async createAssistantReply(ownerUserId: string, conversationId: string) {
    const now = Date.now();

    try {
      const reply = await this.agentRuntime.createReply({ ownerUserId, conversationId });
      if (!reply) return undefined;

      const message = this.repository.save({
        ownerUserId,
        id: `msg_${randomUUID()}`,
        conversationId,
        role: "assistant",
        contentType: "text",
        content: { text: reply.text },
        status: "delivered",
        providerId: reply.providerId,
        model: reply.model,
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
        role: "assistant",
        contentType: "text",
        content: { text: "AI reply is temporarily unavailable. Check the server provider configuration and try again." },
        status: "failed",
        metadata: { kind: "ai_error" },
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

  private async streamAssistantReply(ownerUserId: string, conversationId: string, pendingMessage: Message) {
    let streamedText = "";

    try {
      const reply = await this.agentRuntime.createStreamingReply({ ownerUserId, conversationId }, (delta) => {
        streamedText += delta.text;
        this.appPush.pushToUser(ownerUserId, {
          type: "message.delta",
          messageId: pendingMessage.id,
          conversationId,
          delta: delta.text,
          updatedAt: Date.now()
        });
      });

      if (!reply) return undefined;
      const now = Date.now();
      if (!this.repository.findByIdInConversation(ownerUserId, conversationId, pendingMessage.id)) return undefined;

      const message = this.repository.save({
        ownerUserId,
        id: pendingMessage.id,
        conversationId,
        role: "assistant",
        contentType: "text",
        content: { text: reply.text },
        status: "delivered",
        providerId: reply.providerId,
        model: reply.model,
        createdAt: pendingMessage.createdAt,
        updatedAt: now
      });

      this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: reply.text,
        updatedAt: now,
        incrementUnread: true
      });
      this.appPush.pushToUser(ownerUserId, { type: "message.completed", message });
      return message;
    } catch (error) {
      const now = Date.now();
      if (!this.repository.findByIdInConversation(ownerUserId, conversationId, pendingMessage.id)) return undefined;
      const message = this.repository.save({
        ownerUserId,
        id: pendingMessage.id,
        conversationId,
        role: "assistant",
        contentType: "text",
        content: {
          text: streamedText || "AI reply is temporarily unavailable. Check the server provider configuration and try again."
        },
        status: "failed",
        metadata: { kind: "ai_error" },
        createdAt: pendingMessage.createdAt,
        updatedAt: now
      });

      this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: "AI reply failed.",
        updatedAt: now,
        incrementUnread: true
      });
      this.appPush.pushToUser(ownerUserId, { type: "message.completed", message });
      return message;
    }
  }
}
