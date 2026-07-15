import { randomUUID } from "node:crypto";
import type {
  Message,
  MessageMediaUpload,
  PrimeMessageContent,
} from "@echoo/shared";
import {
  AgentRunQueue,
  type AgentRunJob,
} from "../../infra/redis/run-queue.js";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { PrimeFigureStateRepository } from "../agents/kinds/prime-figure/prime-figure-state.repository.js";
import { AgentRepository } from "../agents/agent.repository.js";
import { SliceFigureRuntimeService } from "../agents/kinds/slice-figure/slice-figure-runtime.service.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { AppPushService } from "../realtime/delivery.service.js";
import {
  InvalidMediaUploadError,
  ResourceRepository,
} from "../resources/resource.repository.js";
import { MessageRepository } from "./message.repository.js";
import { PrimeRunProcessor } from "./prime-run.processor.js";
import { SliceReplyProcessor } from "./slice-reply.processor.js";

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

export type CreateUserMediaMessageInput =
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "image";
      upload?: MessageMediaUpload;
      resourceId?: string;
      clientMessageId?: string | null;
    }
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "voice";
      upload?: MessageMediaUpload;
      resourceId?: string;
      durationSeconds: number;
      clientMessageId?: string | null;
    }
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "sticker";
      stickerId: string;
      clientMessageId?: string | null;
    }
  | {
      ownerUserId: string;
      conversationId: string;
      contentType: "transfer";
      amount: number;
      currency: "CNY";
      note?: string;
      clientMessageId?: string | null;
    };

export type CreateUserMediaMessageResult =
  | { kind: "ok"; message: Message }
  | { kind: "not_found" }
  | { kind: "unsupported_type" }
  | { kind: "invalid_sticker" }
  | { kind: "invalid_media"; message: string };

export type TriggerPrimeFigureHintResult =
  { kind: "ok" } | { kind: "not_found" } | { kind: "unsupported_type" };

export class MessagingService {
  private readonly primeRuns: PrimeRunProcessor;
  private readonly sliceReplies: SliceReplyProcessor;

  constructor(
    private readonly repository = new MessageRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    sliceRuntime = new SliceFigureRuntimeService(),
    primeRuntime = new PrimeFigureRuntimeService(),
    private readonly runQueue = new AgentRunQueue(),
    private readonly resources = new ResourceRepository(),
    private readonly primeStates = new PrimeFigureStateRepository(),
    private readonly agents = new AgentRepository(),
  ) {
    this.primeRuns = new PrimeRunProcessor(primeRuntime, this.appPush);
    this.sliceReplies = new SliceReplyProcessor(
      this.repository,
      this.conversations,
      this.appPush,
      sliceRuntime,
      this.runQueue,
    );
  }

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
      if (message.sequence !== undefined)
        await this.primeStates.recordMessageInteraction({
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          role: "user",
          sequence: message.sequence,
          occurredAtMs: message.createdAt,
        });
      await this.runQueue.enqueue({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        kind: "prime-figure",
      });
      return { message };
    }

    if (conversation.type !== "slice-figure") return { message };

    const assistantMessage = await this.sliceReplies.createPlaceholder(
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

    if (input.contentType === "sticker") {
      const agent = await this.agents.findByConversation(
        input.ownerUserId,
        input.conversationId,
      );
      const sticker =
        agent?.type === "prime-figure"
          ? (agent.detail.stickers ?? []).find(
              (item) => item.resourceId === input.stickerId,
            )
          : undefined;
      if (!sticker) return { kind: "invalid_sticker" };
      const now = Date.now();
      const message = await this.repository.save({
        ownerUserId: input.ownerUserId,
        id: `msg_${randomUUID()}`,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {}),
        conversationId: input.conversationId,
        role: "user",
        contentType: "image",
        content: {
          mediaUrl: sticker.resourcePath,
          resourceId: sticker.resourceId,
          media: {
            resourceId: sticker.resourceId,
            kind: "sticker",
            variants: ["thumb", "display", "original"],
          },
        },
        status: "sent",
        metadata: {
          kind: "prime_figure",
          primeContent: {
            type: "sticker",
            stickerId: sticker.resourceId,
            description: sticker.description,
            resourceId: sticker.resourceId,
            resourceUrl: sticker.resourcePath,
          } satisfies PrimeMessageContent,
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.finishPrimeUserMessage(
        input.ownerUserId,
        input.conversationId,
        message,
        "[表情]",
      );
      return { kind: "ok", message };
    }

    if (input.contentType === "transfer") {
      const now = Date.now();
      const messageId = `msg_${randomUUID()}`;
      const note = input.note?.trim() ?? "";
      const message = await this.repository.save({
        ownerUserId: input.ownerUserId,
        id: messageId,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {}),
        conversationId: input.conversationId,
        role: "user",
        contentType: "text",
        content: {
          text: `[转账] CNY ${input.amount.toFixed(2)}${note ? ` ${note}` : ""}`,
        },
        status: "sent",
        metadata: {
          kind: "prime_figure",
          primeContent: {
            type: "transfer",
            transferId: messageId,
            event: "offer",
            amount: input.amount,
            currency: "CNY",
            direction: "received",
            status: "pending",
            ...(note ? { note } : {}),
          } satisfies PrimeMessageContent,
        },
        createdAt: now,
        updatedAt: now,
      });
      await this.finishPrimeUserMessage(
        input.ownerUserId,
        input.conversationId,
        message,
        `[转账] ¥${input.amount.toFixed(2)}`,
      );
      return { kind: "ok", message };
    }

    let resource;
    let createdResource = false;
    try {
      if (input.resourceId) {
        resource = await this.resources.findById(input.resourceId);
        const expectedKind =
          input.contentType === "image" ? "end_user_image" : "end_user_voice";
        if (
          !resource ||
          resource.ownerUserId !== input.ownerUserId ||
          resource.kind !== expectedKind ||
          resource.status !== "ready"
        )
          return {
            kind: "invalid_media",
            message: "媒体资源尚未就绪或无权访问。",
          };
      } else if (input.upload) {
        resource = await this.resources.saveUserMedia(
          input.ownerUserId,
          input.contentType === "image" ? "end_user_image" : "end_user_voice",
          input.upload,
        );
        createdResource = true;
      } else {
        return { kind: "invalid_media", message: "缺少媒体资源。" };
      }
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
          fileName: input.upload?.fileName ?? resource.originalFileName,
          resourceId: resource.id,
          media: {
            resourceId: resource.id,
            kind: input.contentType,
            variants:
              input.contentType === "image"
                ? ["thumb", "display", "original"]
                : ["original"],
          },
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
      if (createdResource)
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
    if (message.sequence !== undefined)
      await this.primeStates.recordMessageInteraction({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        role: "user",
        sequence: message.sequence,
        occurredAtMs: message.createdAt,
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

  private async finishPrimeUserMessage(
    ownerUserId: string,
    conversationId: string,
    message: Message,
    preview: string,
  ) {
    await this.conversations.updatePreview({
      ownerUserId,
      conversationId,
      preview,
      updatedAt: message.createdAt,
    });
    this.appPush.pushToUser(ownerUserId, {
      type: "message.created",
      message,
    });
    if (message.sequence !== undefined)
      await this.primeStates.recordMessageInteraction({
        ownerUserId,
        conversationId,
        role: "user",
        sequence: message.sequence,
        occurredAtMs: message.createdAt,
      });
    await this.enqueuePrimeFigureRun(ownerUserId, conversationId);
  }

  async resolveFigureTransfer(input: {
    ownerUserId: string;
    conversationId: string;
    messageId: string;
    resolution: "accepted" | "rejected";
  }) {
    const conversation = await this.conversations.findByIdForOwner(
      input.ownerUserId,
      input.conversationId,
    );
    if (!conversation) return { kind: "not_found" as const };
    if (conversation.type !== "prime-figure")
      return { kind: "invalid_transfer" as const };
    const now = Date.now();
    const updated = await this.repository.resolvePendingTransfer({
      ...input,
      expectedRole: "assistant",
      resolvedAtMs: now,
    });
    if (!updated) return { kind: "invalid_transfer" as const };
    const transfer = readPrimeTransfer(updated);
    if (!transfer) return { kind: "invalid_transfer" as const };

    const eventId = `msg_${randomUUID()}`;
    const event = await this.repository.save({
      ownerUserId: input.ownerUserId,
      id: eventId,
      conversationId: input.conversationId,
      role: "user",
      contentType: "text",
      content: { text: "" },
      status: "sent",
      metadata: {
        kind: "transfer_resolution",
        primeContent: {
          ...transfer,
          transferId: eventId,
          event: "resolution",
          status: input.resolution,
          relatedTransferId: input.messageId,
          resolvedAtMs: now,
          resolvedAtIso: new Date(now).toISOString(),
        } satisfies PrimeMessageContent,
      },
      createdAt: now,
      updatedAt: now,
    });
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.updated",
      message: updated,
    });
    this.appPush.pushToUser(input.ownerUserId, {
      type: "message.created",
      message: event,
    });
    if (event.sequence !== undefined)
      await this.primeStates.recordMessageInteraction({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        role: "user",
        sequence: event.sequence,
        occurredAtMs: now,
      });
    await this.enqueuePrimeFigureRun(input.ownerUserId, input.conversationId);
    return { kind: "ok" as const, message: updated };
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
    return job.kind === "prime-figure"
      ? this.primeRuns.process(job)
      : this.sliceReplies.process(job);
  }

  publishAgentActivity(input: {
    ownerUserId: string;
    conversationId: string;
    active: boolean;
    expiresAt?: number;
  }) {
    this.primeRuns.publishActivity(input);
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
      await this.sliceReplies.enqueueMemorySummary(
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
    await this.sliceReplies.enqueueMemorySummary(ownerUserId, conversationId);

    return {
      kind: "ok" as const,
      retainedThroughMessageId: retainedThrough.id,
      deletedCount,
    };
  }
}

function readPrimeTransfer(
  message: Message,
): Extract<PrimeMessageContent, { type: "transfer" }> | null {
  const value = message.metadata?.primeContent;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const transfer = value as Record<string, unknown>;
  if (
    transfer.type !== "transfer" ||
    typeof transfer.transferId !== "string" ||
    typeof transfer.amount !== "number" ||
    typeof transfer.currency !== "string"
  )
    return null;
  return transfer as unknown as Extract<
    PrimeMessageContent,
    { type: "transfer" }
  >;
}
