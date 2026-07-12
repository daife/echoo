import { randomUUID } from "node:crypto";
import type { Message } from "@echoo/shared";
import {
  AgentRunQueue,
  type AgentRunJob,
} from "../../infra/redis/run-queue.js";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { SliceFigureRuntimeService } from "../agents/kinds/slice-figure/slice-figure-runtime.service.js";
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

export type TriggerPrimeFigureHintResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "unsupported_type" };

export class MessagingService {
  constructor(
    private readonly repository = new MessageRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    private readonly sliceRuntime = new SliceFigureRuntimeService(),
    private readonly primeRuntime = new PrimeFigureRuntimeService(),
    private readonly runQueue = new AgentRunQueue(),
  ) {}

  listMessages(
    ownerUserId: string,
    after?: string | null,
    conversationId?: string | null,
    limit?: number,
  ) {
    return this.repository.listAfter(ownerUserId, after, conversationId, limit);
  }

  async listConversationMessages(
    ownerUserId: string,
    conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number },
  ) {
    if (
      !(await this.conversations.findByIdForOwner(ownerUserId, conversationId))
    )
      return null;
    return this.repository.listByConversation(
      ownerUserId,
      conversationId,
      options,
    );
  }

  async createUserTextMessage(
    input: CreateUserTextMessageInput,
  ): Promise<CreateUserTextMessageResult | null> {
    const conversation = await this.conversations.findByIdForOwner(
      input.ownerUserId,
      input.conversationId,
    );
    if (!conversation) return null;

    const existing = await this.repository.findByClientMessageId(
      input.ownerUserId,
      input.clientMessageId,
    );
    if (existing) return { message: existing };

    const now = Date.now();
    const message = await this.repository.save({
      ownerUserId: input.ownerUserId,
      id: `msg_${randomUUID()}`,
      ...(input.clientMessageId
        ? { clientMessageId: input.clientMessageId }
        : {}),
      conversationId: input.conversationId,
      role: "user",
      contentType: "text",
      content: { text: input.text },
      status: "sent",
      createdAt: now,
      updatedAt: now,
    });

    await this.conversations.updatePreview({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      preview: input.text,
      updatedAt: now,
    });
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.created",
      message,
    });

    if (!conversation.agentId) return { message };

    if (conversation.type === "prime-figure") {
      await this.runQueue.enqueue({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        kind: "prime-figure",
      });
      return { message };
    }

    if (conversation.type !== "slice-figure") return { message };

    const assistantMessage = await this.createAssistantPlaceholder(
      input.ownerUserId,
      input.conversationId,
    );
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.created",
      message: assistantMessage,
    });
    await this.runQueue.enqueue({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      kind: "slice-figure",
      assistantMessageId: assistantMessage.id,
    });

    return { message, assistantMessage };
  }

  async triggerPrimeFigureHint(input: {
    ownerUserId: string;
    conversationId: string;
    instruction: string;
  }): Promise<TriggerPrimeFigureHintResult> {
    const conversation = await this.conversations.findByIdForOwner(
      input.ownerUserId,
      input.conversationId,
    );
    if (!conversation) return { kind: "not_found" };
    if (!conversation.agentId || conversation.type !== "prime-figure") {
      return { kind: "unsupported_type" };
    }
    await this.runQueue.enqueue({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      kind: "prime-figure",
      trigger: "debug_hint",
      debugInstruction: input.instruction,
    });
    return { kind: "ok" };
  }

  async processQueuedRun(job: AgentRunJob) {
    if (job.kind === "prime-figure") {
      await this.primeRuntime.requestDecision({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        trigger: job.trigger,
        debugInstruction: job.debugInstruction,
      });
      return;
    }
    if (!job.assistantMessageId) return;
    const pending = await this.repository.findByIdInConversation(
      job.ownerUserId,
      job.conversationId,
      job.assistantMessageId,
    );
    if (!pending || pending.status !== "pending") return;
    await this.streamAssistantReply(
      job.ownerUserId,
      job.conversationId,
      pending,
    );
  }

  publishAgentActivity(input: {
    ownerUserId: string;
    conversationId: string;
    active: boolean;
  }) {
    this.appPush.pushToUser(input.ownerUserId, {
      type: "conversation.agent_activity",
      conversationId: input.conversationId,
      active: input.active,
      updatedAt: Date.now(),
    });
  }

  async markRead(ownerUserId: string, messageId: string, readAt: number) {
    const updated = await this.repository.markRead(
      ownerUserId,
      messageId,
      readAt,
    );
    if (updated) {
      this.appPush.pushToUser(ownerUserId, {
        type: "message.status_changed",
        messageId,
        status: "read",
        updatedAt: readAt,
      });
    }
    return updated;
  }

  async rollbackConversation(
    ownerUserId: string,
    conversationId: string,
    messageId: string,
  ) {
    const conversation = await this.conversations.findByIdForOwner(
      ownerUserId,
      conversationId,
    );
    if (!conversation) return { kind: "not_found" as const };
    if (conversation.type !== "slice-figure")
      return { kind: "unsupported_type" as const };

    const anchor = await this.repository.findByIdInConversation(
      ownerUserId,
      conversationId,
      messageId,
    );
    if (!anchor) return { kind: "message_not_found" as const };

    const retainedThrough =
      anchor.role === "user"
        ? ((await this.repository.findNextAssistantMessage(
            ownerUserId,
            conversationId,
            anchor,
          )) ?? anchor)
        : anchor;
    const deletedCount = await this.repository.deleteAfterMessage(
      ownerUserId,
      conversationId,
      retainedThrough,
    );
    const lastMessage = await this.repository.findLastByConversation(
      ownerUserId,
      conversationId,
    );
    const now = Date.now();

    await this.conversations.updatePreview({
      ownerUserId,
      conversationId,
      preview: lastMessage?.content.text ?? null,
      updatedAt: now,
    });

    return {
      kind: "ok" as const,
      retainedThroughMessageId: retainedThrough.id,
      deletedCount,
    };
  }

  private async createAssistantPlaceholder(
    ownerUserId: string,
    conversationId: string,
  ) {
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
      updatedAt: now,
    });
  }

  private async createAssistantReply(
    ownerUserId: string,
    conversationId: string,
  ) {
    const now = Date.now();

    try {
      const reply = await this.sliceRuntime.createReply({
        ownerUserId,
        conversationId,
      });
      if (!reply) return undefined;

      const message = await this.repository.save({
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
        updatedAt: now,
      });

      await this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: reply.text,
        updatedAt: now,
        incrementUnread: true,
      });
      this.appPush.pushToUser(ownerUserId, {
        type: "message.created",
        message,
      });
      return message;
    } catch (error) {
      const message = await this.repository.save({
        ownerUserId,
        id: `msg_${randomUUID()}`,
        conversationId,
        role: "assistant",
        contentType: "text",
        content: {
          text: "AI reply is temporarily unavailable. Check the server provider configuration and try again.",
        },
        status: "failed",
        metadata: { kind: "ai_error" },
        createdAt: now,
        updatedAt: now,
      });

      await this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: "AI reply failed.",
        updatedAt: now,
        incrementUnread: true,
      });
      this.appPush.pushToUser(ownerUserId, {
        type: "message.created",
        message,
      });
      return message;
    }
  }

  private async streamAssistantReply(
    ownerUserId: string,
    conversationId: string,
    pendingMessage: Message,
  ) {
    let streamedText = "";
    let liveCacheWrite = Promise.resolve();

    try {
      const reply = await this.sliceRuntime.createStreamingReply(
        { ownerUserId, conversationId },
        (delta) => {
          streamedText += delta.text;
          const liveText = streamedText;
          const updatedAt = Date.now();
          this.appPush.pushToUser(ownerUserId, {
            type: "message.delta",
            messageId: pendingMessage.id,
            conversationId,
            delta: delta.text,
            updatedAt,
          });
          liveCacheWrite = liveCacheWrite.then(() =>
            this.repository.updateCachedLive(ownerUserId, {
              ...pendingMessage,
              content: { text: liveText },
              updatedAt,
            }),
          );
        },
      );

      if (!reply) return undefined;
      await liveCacheWrite;
      const now = Date.now();
      if (
        !(await this.repository.findByIdInConversation(
          ownerUserId,
          conversationId,
          pendingMessage.id,
        ))
      )
        return undefined;

      const message = await this.repository.save({
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
        updatedAt: now,
      });

      await this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: reply.text,
        updatedAt: now,
        incrementUnread: true,
      });
      this.appPush.pushToUser(ownerUserId, {
        type: "message.completed",
        message,
      });
      return message;
    } catch (error) {
      await liveCacheWrite;
      const now = Date.now();
      if (
        !(await this.repository.findByIdInConversation(
          ownerUserId,
          conversationId,
          pendingMessage.id,
        ))
      )
        return undefined;
      const message = await this.repository.save({
        ownerUserId,
        id: pendingMessage.id,
        conversationId,
        role: "assistant",
        contentType: "text",
        content: {
          text:
            streamedText ||
            "AI reply is temporarily unavailable. Check the server provider configuration and try again.",
        },
        status: "failed",
        metadata: { kind: "ai_error" },
        createdAt: pendingMessage.createdAt,
        updatedAt: now,
      });

      await this.conversations.updatePreview({
        ownerUserId,
        conversationId,
        preview: "AI reply failed.",
        updatedAt: now,
        incrementUnread: true,
      });
      this.appPush.pushToUser(ownerUserId, {
        type: "message.completed",
        message,
      });
      return message;
    }
  }
}
