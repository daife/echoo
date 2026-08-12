import { randomUUID } from "node:crypto";
import type { Message } from "@echoo/shared";
import {
  AgentRunQueue,
  type AgentRunJob,
} from "../../infra/redis/run-queue.js";
import { SliceFigureRuntimeService } from "../agents/kinds/slice-figure/slice-figure-runtime.service.js";
import { AgentRunFailureRepository } from "../agents/agent-run-failure.repository.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { AppPushService } from "../realtime/delivery.service.js";
import { MessageRepository } from "./message.repository.js";

export class SliceReplyProcessor {
  constructor(
    private readonly repository = new MessageRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    private readonly runtime = new SliceFigureRuntimeService(),
    private readonly runQueue = new AgentRunQueue(),
    private readonly failures = new AgentRunFailureRepository(),
  ) {}

  async createPlaceholder(
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

  async process(job: AgentRunJob) {
    if (job.trigger === "memory_summary") {
      const summaries = await this.runtime.createPendingMemorySummaries({
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
    await this.streamReply(job.ownerUserId, job.conversationId, pending, job);
  }

  async enqueueMemorySummary(ownerUserId: string, conversationId: string) {
    await this.runQueue.enqueue({
      ownerUserId,
      conversationId,
      kind: "slice-figure",
      trigger: "memory_summary",
    });
  }

  private async streamReply(
    ownerUserId: string,
    conversationId: string,
    pendingMessage: Message,
    job: AgentRunJob,
  ) {
    let streamedText = "";
    let liveCacheWrite = Promise.resolve();
    let pendingDelta = "";
    let deltaTimer: NodeJS.Timeout | undefined;
    const flushDelta = () => {
      if (deltaTimer) clearTimeout(deltaTimer);
      deltaTimer = undefined;
      const delta = pendingDelta;
      pendingDelta = "";
      if (!delta) return;
      const updatedAt = Date.now();
      this.appPush.pushToUser(ownerUserId, {
        type: "message.delta",
        messageId: pendingMessage.id,
        conversationId,
        delta,
        updatedAt,
      });
      const liveText = streamedText;
      liveCacheWrite = liveCacheWrite.then(() =>
        this.repository.updateCachedLive(ownerUserId, {
          ...pendingMessage,
          content: { text: liveText },
          updatedAt,
        }),
      );
    };
    try {
      const reply = await this.runtime.createStreamingReply(
        { ownerUserId, conversationId },
        (delta) => {
          streamedText += delta.text;
          pendingDelta += delta.text;
          if (pendingDelta.length >= 1_024) flushDelta();
          else if (!deltaTimer) {
            deltaTimer = setTimeout(flushDelta, 40);
            deltaTimer.unref();
          }
        },
      );
      if (!reply) return undefined;
      flushDelta();
      await liveCacheWrite;
      if (
        !(await this.pendingStillExists(
          ownerUserId,
          conversationId,
          pendingMessage.id,
        ))
      )
        return undefined;
      const now = Date.now();
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
      void import("../channels/wechat.service.js").then(({ WechatService }) =>
        new WechatService()
          .deliver(message)
          .catch((error) => console.warn("微信回复投递失败", error)),
      );
      await this.createMemorySummariesOrQueueRetry(ownerUserId, conversationId);
      return message;
    } catch (error) {
      flushDelta();
      await liveCacheWrite;
      if (
        !(await this.pendingStillExists(
          ownerUserId,
          conversationId,
          pendingMessage.id,
        ))
      )
        return undefined;
      await this.failures.record({
        ownerUserId,
        conversationId,
        kind: "slice-figure",
        runId: job.runId,
        phase: "reply_generation",
        errorMessage:
          error instanceof Error ? error.message : "切片角色回复生成失败。",
        cause: error,
        diagnostics: {
          assistantMessageId: pendingMessage.id,
          trigger: job.trigger,
        },
      });
      const now = Date.now();
      const message = await this.repository.save({
        ownerUserId,
        id: pendingMessage.id,
        conversationId,
        role: "system",
        contentType: "system",
        content: {
          text: "AI reply is temporarily unavailable. Check the server provider configuration and try again.",
        },
        status: "delivered",
        metadata: { kind: "slice_runtime_error" },
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

  private async pendingStillExists(
    ownerUserId: string,
    conversationId: string,
    messageId: string,
  ) {
    return Boolean(
      await this.repository.findByIdInConversation(
        ownerUserId,
        conversationId,
        messageId,
      ),
    );
  }

  private async createMemorySummariesOrQueueRetry(
    ownerUserId: string,
    conversationId: string,
  ) {
    try {
      const summaries = await this.runtime.createPendingMemorySummaries({
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
        await this.enqueueMemorySummary(ownerUserId, conversationId);
      } catch (queueError) {
        console.warn(
          "Slice figure memory summary retry enqueue failed.",
          queueError,
        );
      }
    }
  }
}
