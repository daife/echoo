import { randomUUID } from "node:crypto";
import type { Message, MessageMediaUpload } from "@echoo/shared";
import {
  AgentRunQueue,
  type AgentRunJob,
} from "../../infra/redis/run-queue.js";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { SliceFigureRuntimeService } from "../agents/kinds/slice-figure/slice-figure-runtime.service.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { AppPushService } from "../realtime/delivery.service.js";
import {
  InvalidMediaUploadError,
  ResourceRepository,
} from "../resources/resource.repository.js";
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

export type CreateUserMediaMessageInput =
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "image";
      upload: MessageMediaUpload;
      clientMessageId?: string | null;
    }
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "voice";
      upload: MessageMediaUpload;
      durationSeconds: number;
      clientMessageId?: string | null;
    };

export type CreateUserMediaMessageResult =
  | { kind: "ok"; message: Message }
  | { kind: "not_found" }
  | { kind: "unsupported_type" }
  | { kind: "invalid_media"; message: string };

export type TriggerPrimeFigureHintResult =
  { kind: "ok" } | { kind: "not_found" } | { kind: "unsupported_type" };

export class MessagingService {
  constructor(
    private readonly repository = new MessageRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    private readonly sliceRuntime = new SliceFigureRuntimeService(),
    private readonly primeRuntime = new PrimeFigureRuntimeService(),
    private readonly runQueue = new AgentRunQueue(),
    private readonly resources = new ResourceRepository(),
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
      message.id,
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

  async createUserMediaMessage(
    input: CreateUserMediaMessageInput,
  ): Promise<CreateUserMediaMessageResult> {
    const conversation = await this.conversations.findByIdForOwner(
      input.ownerUserId,
      input.conversationId,
    );
    if (!conversation) return { kind: "not_found" };
    if (conversation.type !== "prime-figure" || !conversation.agentId)
      return { kind: "unsupported_type" };

    const existing = await this.repository.findByClientMessageId(
      input.ownerUserId,
      input.clientMessageId,
    );
    if (existing) {
      await this.enqueuePrimeFigureRun(input.ownerUserId, input.conversationId);
      return { kind: "ok", message: existing };
    }

    let resource;
    try {
      resource = await this.resources.saveUserMedia(
        input.ownerUserId,
        input.contentType === "image" ? "end_user_image" : "end_user_voice",
        input.upload,
      );
    } catch (error) {
      if (!(error instanceof InvalidMediaUploadError)) throw error;
      return {
        kind: "invalid_media",
        message: error instanceof Error ? error.message : "媒体文件无效。",
      };
    }
    const now = Date.now();
    let message: Message;
    try {
      message = await this.repository.save({
        ownerUserId: input.ownerUserId,
        id: `msg_${randomUUID()}`,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {}),
        conversationId: input.conversationId,
        role: "user",
        contentType: input.contentType,
        content: {
          mediaUrl: resource.publicPath,
          fileName: input.upload.fileName,
          resourceId: resource.id,
        },
        status: "sent",
        ...(input.contentType === "voice"
          ? {
              metadata: {
                mediaIntent: {
                  status: "ready",
                  durationSeconds:
                    resource.durationSeconds ?? input.durationSeconds,
                },
              },
            }
          : {}),
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await this.resources.deleteOwnedByPublicPath(
        input.ownerUserId,
        resource.publicPath,
      );
      throw error;
    }

    await this.conversations.updatePreview({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      preview: input.contentType === "image" ? "[图片]" : "[语音]",
      updatedAt: now,
    });
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.created",
      message,
    });
    await this.enqueuePrimeFigureRun(input.ownerUserId, input.conversationId);
    return { kind: "ok", message };
  }

  private enqueuePrimeFigureRun(ownerUserId: string, conversationId: string) {
    return this.runQueue.enqueue({
      ownerUserId,
      conversationId,
      kind: "prime-figure",
    });
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
        trigger: job.trigger === "memory_summary" ? undefined : job.trigger,
        debugInstruction: job.debugInstruction,
      });
      return;
    }
    if (job.trigger === "memory_summary") {
      const summaries = await this.sliceRuntime.createPendingMemorySummaries({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
      });
      for (const message of summaries)
        this.appPush.pushToUser(job.ownerUserId, {
          type: "message.completed",
          message,
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

  async updateAssistantTextMessage(input: {
    ownerUserId: string;
    conversationId: string;
    messageId: string;
    text: string;
  }) {
    const conversation = await this.conversations.findByIdForOwner(
      input.ownerUserId,
      input.conversationId,
    );
    if (!conversation) return { kind: "not_found" as const };
    if (conversation.type !== "slice-figure")
      return { kind: "unsupported_type" as const };

    const message = await this.repository.findByIdInConversation(
      input.ownerUserId,
      input.conversationId,
      input.messageId,
    );
    if (!message) return { kind: "message_not_found" as const };
    if (message.role !== "assistant" || message.contentType !== "text")
      return { kind: "unsupported_message" as const };
    if (message.status === "pending") return { kind: "pending" as const };

    const lastMessage = await this.repository.findLastPreviewMessage(
      input.ownerUserId,
      input.conversationId,
    );
    const now = Date.now();
    const updated = await this.repository.updateText(
      input.ownerUserId,
      input.conversationId,
      input.messageId,
      input.text,
      now,
    );
    if (!updated) return { kind: "message_not_found" as const };
    if (lastMessage?.id === updated.id) {
      await this.conversations.updatePreview({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        preview: input.text,
        updatedAt: now,
      });
    }
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.updated",
      message: updated,
    });
    if (message.sequence) {
      const invalidated =
        await this.repository.invalidateMemorySummariesCovering(
          input.ownerUserId,
          input.conversationId,
          message.sequence,
        );
      for (const summary of invalidated)
        this.appPush.pushToUser(input.ownerUserId, {
          type: "message.updated",
          message: summary,
        });
      await this.enqueueSliceMemorySummary(
        input.ownerUserId,
        input.conversationId,
      );
    }
    return { kind: "ok" as const, message: updated };
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
    const lastMessage = await this.repository.findLastPreviewMessage(
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
    await this.enqueueSliceMemorySummary(ownerUserId, conversationId);

    return {
      kind: "ok" as const,
      retainedThroughMessageId: retainedThrough.id,
      deletedCount,
    };
  }

  private async createAssistantPlaceholder(
    ownerUserId: string,
    conversationId: string,
    replyToMessageId?: string,
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
      ...(replyToMessageId ? { metadata: { replyToMessageId } } : {}),
      createdAt: now,
      updatedAt: now,
    });
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
        metadata: pendingMessage.metadata,
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
      try {
        const summaries = await this.sliceRuntime.createPendingMemorySummaries({
          ownerUserId,
          conversationId,
        });
        for (const summary of summaries)
          this.appPush.pushToUser(ownerUserId, {
            type: "message.completed",
            message: summary,
          });
      } catch (error) {
        console.warn(
          "Slice figure memory summary failed; queued for retry.",
          error,
        );
        try {
          await this.enqueueSliceMemorySummary(ownerUserId, conversationId);
        } catch (queueError) {
          console.warn(
            "Slice figure memory summary retry enqueue failed.",
            queueError,
          );
        }
      }
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

  private async enqueueSliceMemorySummary(
    ownerUserId: string,
    conversationId: string,
  ) {
    await this.runQueue.enqueue({
      ownerUserId,
      conversationId,
      kind: "slice-figure",
      trigger: "memory_summary",
    });
  }
}
