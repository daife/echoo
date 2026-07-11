import { randomUUID } from "node:crypto";
import { primeFigureDecisionSchema } from "@echoo/shared";
import type {
  Message,
  MessageContent,
  MessageContentType,
  PrimeFigureAgent,
  PrimeFigureDecision,
  PrimeFigureOutgoingMessage,
  PrimeFigureState,
  PrimeFigureVariableValue,
  PrimeMessageContent,
} from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";
import { ConversationRepository } from "../../../conversations/conversation.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import { PrimeFigureRepository } from "./prime-figure.repository.js";
import { parseReadableMinute } from "./prime-time.js";
import type { ResolvedPrimeVoiceMedia } from "./prime-decision-stream-session.js";

export class PrimeActionExecutor {
  private readonly db = getDatabase();

  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly figures = new PrimeFigureRepository(),
    private readonly primeMessages = new PrimeMessageRepository(),
    private readonly messages = new MessageRepository(),
    private readonly logs = new PrimeActionLogRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
  ) {}

  executeDecision(input: {
    ownerUserId: string;
    conversationId: string;
    agent: PrimeFigureAgent;
    state: PrimeFigureState;
    decision: PrimeFigureDecision;
    providerId: string;
    model: string;
    streamedMessageIds?: Map<number, string>;
    voiceMedia?: Map<number, ResolvedPrimeVoiceMedia>;
    ttsErrors?: Map<number, string>;
  }) {
    const decision = primeFigureDecisionSchema.parse(
      input.decision,
    ) as PrimeFigureDecision;
    const now = Date.now();
    const state: PrimeFigureState = {
      ...input.state,
      variables: applyVariableSnapshot(
        input.agent,
        input.state.variables,
        decision.variables,
      ),
      memories: appendMemories(
        input.state,
        decision,
        input.agent.detail.schedule.timezone,
        now,
      ),
      mood: decision.figureMood,
      moodObservedAtMs: now,
      relationshipStatus:
        decision.stateUpdates?.relationshipStatus ??
        input.state.relationshipStatus,
      updatedAt: now,
    };
    const createdMessages: Array<{ message: Message; streamed: boolean }> = [];

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const silenceAction = decision.actions.find(
        (action) => action.type === "silence",
      );
      if (!silenceAction) {
        delete state.silenceStartedAtMs;
        delete state.silenceUntilMs;

        decision.actions.forEach((action, index) => {
          if (action.type !== "send_message") return;
          const occurredAtMs = now + index;
          const voiceMedia = input.voiceMedia?.get(index);
          const primeContent = toPrimeMessageContent(
            action.message,
            voiceMedia,
          );
          const primeMessage = this.primeMessages.save({
            ownerUserId: input.ownerUserId,
            agentId: input.agent.id,
            conversationId: input.conversationId,
            sender: "prime_figure",
            content: primeContent,
            occurredAtMs,
            timezone: input.agent.detail.schedule.timezone,
          });
          const streamedMessageId = input.streamedMessageIds?.get(index);
          createdMessages.push({
            streamed: Boolean(streamedMessageId),
            message: this.messages.save({
              ownerUserId: input.ownerUserId,
              id: streamedMessageId ?? `msg_${randomUUID()}`,
              conversationId: input.conversationId,
              role: "assistant",
              contentType: toMessageContentType(action.message),
              content: toMessageContent(action.message, voiceMedia),
              status: "delivered",
              providerId: input.providerId,
              model: input.model,
              metadata: {
                kind: "prime_figure",
                primeMessageId: primeMessage.id,
                ...toMediaIntentMetadata(
                  action.message,
                  voiceMedia,
                  input.ttsErrors?.get(index),
                ),
              },
              createdAt: occurredAtMs,
              updatedAt: occurredAtMs,
            }),
          });
        });
        const lastMessage = decision.actions.at(-1);
        if (lastMessage?.type !== "send_message")
          throw new Error("本初角色的发送动作列表无效。");
        this.conversations.updatePreview({
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          preview: toConversationPreview(lastMessage.message),
          updatedAt: now + decision.actions.length - 1,
          unreadIncrement: decision.actions.length,
        });
      } else {
        state.silenceStartedAtMs = now;
        state.silenceUntilMs = now + silenceAction.revisitAfterMinutes * 60_000;
      }

      this.figures.applyRuntimeUpdates(
        input.agent.id,
        input.agent.detail,
        decision.stateUpdates ?? {},
      );
      this.states.save(input.ownerUserId, input.agent.id, state);
      decision.actions.forEach((action) =>
        this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: input.agent.id,
          conversationId: input.conversationId,
          action,
          rationale: decision.rationale,
          status: "applied",
          now,
        }),
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: input.agent.id,
        conversationId: input.conversationId,
        action: { type: "prime_decision", actions: decision.actions },
        rationale: decision.rationale,
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "本初角色决定执行失败。",
      });
      throw error;
    }

    for (const created of createdMessages)
      this.appPush.pushToUser(input.ownerUserId, {
        type: created.streamed ? "message.completed" : "message.created",
        message: created.message,
      });
    return state;
  }
}

function toPrimeMessageContent(
  message: PrimeFigureOutgoingMessage,
  voiceMedia?: ResolvedPrimeVoiceMedia,
): PrimeMessageContent {
  if (message.type === "image") {
    return {
      ...message,
      referenceResourceUrls: [],
    };
  }
  if (message.type === "voice") {
    return {
      ...message,
      ...(voiceMedia
        ? {
            resourceId: voiceMedia.resourceId,
            resourceUrl: voiceMedia.mediaUrl,
          }
        : {}),
    };
  }
  return message;
}

function toMessageContentType(
  message: PrimeFigureOutgoingMessage,
): MessageContentType {
  return message.type;
}

function toMessageContent(
  message: PrimeFigureOutgoingMessage,
  voiceMedia?: ResolvedPrimeVoiceMedia,
): MessageContent {
  if (message.type === "text") return { text: message.text };
  if (message.type === "image") return { text: message.description };
  return {
    text: message.transcript,
    ...(voiceMedia ? { mediaUrl: voiceMedia.mediaUrl } : {}),
  };
}

function toMediaIntentMetadata(
  message: PrimeFigureOutgoingMessage,
  voiceMedia?: ResolvedPrimeVoiceMedia,
  ttsError?: string,
) {
  if (message.type === "image") {
    return {
      mediaIntent: {
        status: "pending_generation",
        generationPrompt: message.generationPrompt,
      },
    };
  }
  if (message.type === "voice") {
    return {
      mediaIntent: {
        status: voiceMedia ? "ready" : "tts_failed",
        ...(ttsError ? { error: ttsError } : {}),
      },
    };
  }
  return {};
}

function toConversationPreview(message: PrimeFigureOutgoingMessage) {
  if (message.type === "text") return message.text;
  if (message.type === "image") return `[图片] ${message.description}`;
  return `[语音] ${message.transcript}`;
}

function appendMemories(
  state: PrimeFigureState,
  decision: PrimeFigureDecision,
  timezone: string,
  now: number,
) {
  const writes = (decision.memoryWrites ?? []).map((memory) => ({
    id: `pmem_${randomUUID()}`,
    content: memory.content,
    eventAtMs: memory.eventAt
      ? (parseReadableMinute(memory.eventAt, timezone) ?? now)
      : now,
    recordedAtMs: now,
  }));
  return [...state.memories, ...writes].slice(-1000);
}

function applyVariableSnapshot(
  agent: PrimeFigureAgent,
  current: Record<string, PrimeFigureVariableValue>,
  output: Record<string, PrimeFigureVariableValue>,
) {
  const next: Record<string, PrimeFigureVariableValue> = {};

  for (const definition of agent.detail.variableDefinitions) {
    const value = output[definition.key];
    if (value === undefined || value === null) {
      if (current[definition.key] !== undefined)
        next[definition.key] = current[definition.key];
      continue;
    }

    if (definition.type === "string") {
      if (typeof value !== "string")
        throw new Error(`变量 ${definition.key} 必须是字符串。`);
      next[definition.key] = value;
      continue;
    }
    if (definition.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`变量 ${definition.key} 必须是有限数字。`);
      next[definition.key] = Math.min(
        Math.max(value, definition.min ?? Number.NEGATIVE_INFINITY),
        definition.max ?? Number.POSITIVE_INFINITY,
      );
      continue;
    }
    if (definition.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`变量 ${definition.key} 必须是布尔值。`);
      next[definition.key] = value;
      continue;
    }

    if (typeof value === "string") {
      try {
        next[definition.key] = JSON.parse(value) as PrimeFigureVariableValue;
      } catch {
        throw new Error(`变量 ${definition.key} 必须包含有效 JSON。`);
      }
    } else {
      next[definition.key] = value;
    }
  }

  return next;
}
