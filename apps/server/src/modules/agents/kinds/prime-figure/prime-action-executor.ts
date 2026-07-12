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
import { createId } from "../../../../shared/utils/id.js";
import { APP_TIME_ZONE } from "../../../../shared/constants/time.js";
import { ConversationRepository } from "../../../conversations/conversation.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import { PrimeFigureRepository } from "./prime-figure.repository.js";
import { parseReadableMinute } from "./prime-time.js";
import type {
  ResolvedPrimeImageMedia,
  ResolvedPrimeVoiceMedia,
} from "./prime-decision-stream-session.js";

export class PrimeActionExecutor {
  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly figures = new PrimeFigureRepository(),
    private readonly messages = new MessageRepository(),
    private readonly logs = new PrimeActionLogRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
  ) {}

  async executeDecision(input: {
    ownerUserId: string;
    conversationId: string;
    agent: PrimeFigureAgent;
    state: PrimeFigureState;
    decision: PrimeFigureDecision;
    providerId: string;
    model: string;
    muteMessageCutoffAtMs?: number;
    streamedMessageIds?: Map<number, string>;
    messageCreatedAt?: Map<number, number>;
    voiceMedia?: Map<number, ResolvedPrimeVoiceMedia>;
    ttsErrors?: Map<number, string>;
    imageMedia?: Map<number, ResolvedPrimeImageMedia>;
    imageGenerationErrors?: Map<number, string>;
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
      memories: appendMemories(input.state, decision, APP_TIME_ZONE, now),
      mood: decision.figureMood,
      moodObservedAtMs: now,
      relationshipStatus:
        decision.stateUpdates?.relationshipStatus ??
        input.state.relationshipStatus,
      updatedAt: now,
    };
    const createdMessages: Array<{ message: Message; streamed: boolean }> = [];

    try {
      const muteAction = decision.actions.find(
        (action) => action.type === "mute",
      );
      if (!muteAction) {
        delete state.silenceStartedAtMs;
        delete state.silenceUntilMs;

        for (const [index, action] of decision.actions.entries()) {
          if (action.type !== "send_message") continue;
          const occurredAtMs =
            input.messageCreatedAt?.get(index) ?? now + index;
          const voiceMedia = input.voiceMedia?.get(index);
          const imageMedia = input.imageMedia?.get(index);
          const primeContent = toPrimeMessageContent(
            action.message,
            voiceMedia,
            imageMedia,
          );
          const streamedMessageId = input.streamedMessageIds?.get(index);
          createdMessages.push({
            streamed: Boolean(streamedMessageId),
            message: await this.messages.save({
              ownerUserId: input.ownerUserId,
              id: streamedMessageId ?? createId("msg"),
              conversationId: input.conversationId,
              role: "assistant",
              contentType: toMessageContentType(action.message),
              content: toMessageContent(action.message, voiceMedia, imageMedia),
              status: "delivered",
              providerId: input.providerId,
              model: input.model,
              metadata: {
                kind: "prime_figure",
                primeContent,
                ...toMediaIntentMetadata(
                  action.message,
                  voiceMedia,
                  input.ttsErrors?.get(index),
                  imageMedia,
                  input.imageGenerationErrors?.get(index),
                ),
              },
              createdAt: occurredAtMs,
              updatedAt: occurredAtMs,
            }),
          });
        }
        const lastMessage = decision.actions.at(-1);
        if (lastMessage?.type === "send_message") {
          await this.conversations.updatePreview({
            ownerUserId: input.ownerUserId,
            conversationId: input.conversationId,
            preview: toConversationPreview(lastMessage.message),
            updatedAt: now + decision.actions.length - 1,
            unreadIncrement: decision.actions.length,
          });
        } else if (lastMessage?.type !== "silence") {
          throw new Error("本初角色的动作列表无效。");
        }
      } else {
        state.silenceStartedAtMs = input.muteMessageCutoffAtMs ?? now;
        state.silenceUntilMs = now + muteAction.revisitAfterMinutes * 60_000;
      }

      await this.figures.applyRuntimeUpdates(
        input.agent.id,
        input.agent.detail,
        decision.stateUpdates ?? {},
      );
      await this.states.save(input.ownerUserId, input.agent.id, state);
      this.appPush.pushToUser(input.ownerUserId, {
        type: "conversation.agent_mute_changed",
        conversationId: input.conversationId,
        muteUntilMs:
          state.silenceUntilMs && state.silenceUntilMs > Date.now()
            ? state.silenceUntilMs
            : null,
        updatedAt: Date.now(),
      });
      await Promise.all(
        decision.actions.map((action) =>
          this.logs.save({
            ownerUserId: input.ownerUserId,
            agentId: input.agent.id,
            conversationId: input.conversationId,
            action,
            rationale: decision.rationale,
            status: "applied",
            now,
          }),
        ),
      );
    } catch (error) {
      await this.logs.save({
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
  imageMedia?: ResolvedPrimeImageMedia,
): PrimeMessageContent {
  if (message.type === "image") {
    return {
      ...message,
      referenceResourceUrls: [],
      ...(imageMedia
        ? {
            resourceId: imageMedia.resourceId,
            resourceUrl: imageMedia.mediaUrl,
          }
        : {}),
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
  imageMedia?: ResolvedPrimeImageMedia,
): MessageContent {
  if (message.type === "text") return { text: message.text };
  if (message.type === "image")
    return {
      text: message.description,
      ...(imageMedia ? { mediaUrl: imageMedia.mediaUrl } : {}),
    };
  return {
    text: message.transcript,
    ...(voiceMedia ? { mediaUrl: voiceMedia.mediaUrl } : {}),
  };
}

function toMediaIntentMetadata(
  message: PrimeFigureOutgoingMessage,
  voiceMedia?: ResolvedPrimeVoiceMedia,
  ttsError?: string,
  imageMedia?: ResolvedPrimeImageMedia,
  imageGenerationError?: string,
) {
  if (message.type === "image") {
    return {
      mediaIntent: {
        status: imageMedia ? "ready" : "generation_failed",
        generationPrompt: message.generationPrompt,
        referenceMediaIds: message.referenceMediaIds,
        ...(imageMedia
          ? {
              generatedMediaId: imageMedia.mediaId,
              generationModel: imageMedia.model,
            }
          : {}),
        ...(imageGenerationError ? { error: imageGenerationError } : {}),
      },
    };
  }
  if (message.type === "voice") {
    return {
      mediaIntent: {
        status: voiceMedia ? "ready" : "tts_failed",
        ...(voiceMedia
          ? { durationSeconds: voiceMedia.durationSeconds }
          : {}),
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
    id: createId("pmem"),
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
