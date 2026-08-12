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
import {
  invalidatesProactiveWakeup,
  PrimeFigureStateRepository,
} from "./prime-figure-state.repository.js";
import { parseReadableMinute } from "./prime-time.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import type { PrimeDecisionTrigger } from "./prime-figure-runtime.service.js";
import { createVisualMediaReference } from "../../../resources/media-reference.js";
import {
  textMessageGapMs,
  type ResolvedPrimeImageMedia,
  type ResolvedPrimeVoiceMedia,
} from "./prime-decision-stream-session.js";
import { isPrimeOutputEnabled } from "./prime-output-capabilities.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";

export class PrimeActionExecutor {
  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly messages = new MessageRepository(),
    private readonly logs = new PrimeActionLogRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly appPush = new AppPushService(),
    private readonly resources = new ResourceRepository(),
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
    paceUnstreamedMessages?: boolean;
    voiceMedia?: Map<number, ResolvedPrimeVoiceMedia>;
    ttsErrors?: Map<number, string>;
    imageMedia?: Map<number, ResolvedPrimeImageMedia>;
    imageGenerationErrors?: Map<number, string>;
    trigger?: PrimeDecisionTrigger;
    runtimeConfig?: StoredPrimeFigureRuntimeConfig;
    wakeupToken?: string;
    passiveStage?: 1 | 2 | 3;
    inputThroughEndUserSeq?: number;
    interactionBaselineSequence?: number;
  }) {
    const decision = input.decision;
    const now = Date.now();
    const trigger = input.trigger ?? "end_user_message";
    const wakeups = input.runtimeConfig?.wakeups ?? DEFAULT_WAKEUP_CONFIG;
    const state: PrimeFigureState = {
      ...input.state,
      variables: applyVariableSnapshot(
        input.agent,
        input.state.variables,
        decision.variables,
      ),
      memories: appendMemories(input.state, decision, APP_TIME_ZONE, now),
      currentSituation:
        decision.stateUpdates?.currentSituation ?? input.state.currentSituation,
      schedule: decision.stateUpdates?.schedule ?? input.state.schedule,
      itinerary: decision.stateUpdates?.itinerary ?? input.state.itinerary,
      mood: decision.figureMood,
      moodObservedAtMs: now,
      relationshipStatus:
        decision.stateUpdates?.relationshipStatus ??
        input.state.relationshipStatus,
      updatedAt: now,
    };
    const createdMessages: Array<{
      actionIndex: number;
      message: Message;
      streamed: boolean;
    }> = [];
    const updatedTransferMessages: Message[] = [];
    let pacedOutputCount = 0;
    let previousPacedOutputCompletedAt = Date.now();
    const waitForPacedReveal = async (visibleText?: string) => {
      if (!input.paceUnstreamedMessages) return;
      const hasPredecessor = pacedOutputCount > 0;
      pacedOutputCount += 1;
      if (hasPredecessor && visibleText !== undefined) {
        const elapsed = Date.now() - previousPacedOutputCompletedAt;
        const remaining =
          textMessageGapMs(
            visibleText,
            input.runtimeConfig?.typingCharsPerMinute ?? 300,
          ) - elapsed;
        if (remaining > 0) await delay(remaining);
      }
    };
    const publishPacedMessage = (created: {
      message: Message;
      streamed: boolean;
    }) => {
      if (!input.paceUnstreamedMessages) return;
      this.appPush.pushToUser(input.ownerUserId, {
        type: created.streamed ? "message.completed" : "message.created",
        message: created.message,
      });
      previousPacedOutputCompletedAt = Date.now();
    };

    try {
      const previousSilenceStartedAtMs = state.silenceStartedAtMs;
      const previousSilenceUntilMs = state.silenceUntilMs;
      const muteAction = [...decision.actions]
        .reverse()
        .find(
          (action) =>
            action.type === "mute" && action.revisitAfterMinutes !== null,
        );
      if (
        muteAction?.type === "mute" &&
        muteAction.revisitAfterMinutes !== null
      ) {
        state.silenceStartedAtMs = input.muteMessageCutoffAtMs ?? now;
        state.silenceUntilMs = now + muteAction.revisitAfterMinutes * 60_000;
      } else if (
        decision.actions.some(
          (action) =>
            action.type === "send_message" ||
            action.type === "transfer" ||
            (action.type === "mute" && action.revisitAfterMinutes === null),
        )
      ) {
        delete state.silenceStartedAtMs;
        delete state.silenceUntilMs;
      }
      const muteChanged =
        state.silenceStartedAtMs !== previousSilenceStartedAtMs ||
        state.silenceUntilMs !== previousSilenceUntilMs;

      for (const [index, action] of decision.actions.entries()) {
        if (action.type === "transfer") {
          if (
            input.runtimeConfig &&
            !isPrimeOutputEnabled(input.runtimeConfig, "transfer")
          )
            continue;
          if (action.operation === "accept" || action.operation === "reject") {
            const updated = await this.messages.resolvePendingTransfer({
              ownerUserId: input.ownerUserId,
              conversationId: input.conversationId,
              messageId: action.transferId,
              expectedRole: "user",
              resolution:
                action.operation === "accept" ? "accepted" : "rejected",
              resolvedAtMs: now + index,
            });
            if (updated) updatedTransferMessages.push(updated);
            continue;
          }
          if (action.operation !== "send") continue;
          await waitForPacedReveal();
          const occurredAtMs = input.paceUnstreamedMessages
            ? Date.now()
            : (input.messageCreatedAt?.get(index) ?? now + index);
          const messageId =
            input.streamedMessageIds?.get(index) ?? createId("msg");
          const note = action.note.trim();
          const created = {
            actionIndex: index,
            streamed: Boolean(input.streamedMessageIds?.get(index)),
            message: await this.messages.save({
              ownerUserId: input.ownerUserId,
              id: messageId,
              conversationId: input.conversationId,
              role: "assistant",
              contentType: "text",
              content: {
                text: `[转账] CNY ${action.amount.toFixed(2)}${note ? ` ${note}` : ""}`,
              },
              status: "delivered",
              providerId: input.providerId,
              model: input.model,
              metadata: {
                kind: "prime_figure",
                primeContent: {
                  type: "transfer",
                  transferId: messageId,
                  event: "offer",
                  amount: action.amount,
                  currency: "CNY",
                  direction: "paid",
                  status: "pending",
                  ...(note ? { note } : {}),
                } satisfies PrimeMessageContent,
              },
              createdAt: occurredAtMs,
              updatedAt: occurredAtMs,
            }),
          };
          createdMessages.push(created);
          publishPacedMessage(created);
          continue;
        }
        if (action.type !== "send_message") continue;
        if (
          action.message.type === "sticker" &&
          input.runtimeConfig &&
          !isPrimeOutputEnabled(input.runtimeConfig, "sticker")
        )
          continue;
        if (action.message.type === "sticker") {
          const stickerId = action.message.stickerId;
          const sticker = (input.agent.detail.stickers ?? []).find(
            (item) => item.resourceId === stickerId,
          );
          const resource = sticker
            ? await this.resources.findAgentResourceById(
                input.ownerUserId,
                input.agent.id,
                sticker.resourceId,
                "sticker",
              )
            : null;
          if (
            !sticker ||
            !resource ||
            resource.status !== "ready" ||
            !resource.mimeType.startsWith("image/")
          )
            continue;
        }
        await waitForPacedReveal(timedMessageText(action.message));
        const occurredAtMs = input.paceUnstreamedMessages
          ? Date.now()
          : (input.messageCreatedAt?.get(index) ?? now + index);
        const voiceMedia = input.voiceMedia?.get(index);
        const imageMedia = input.imageMedia?.get(index);
        const status =
          action.message.type === "image" &&
          !action.message.description.trim() &&
          !imageMedia
            ? "failed"
            : "delivered";
        const primeContent = toPrimeMessageContent(
          action.message,
          input.agent,
          voiceMedia,
          imageMedia,
        );
        const streamedMessageId = input.streamedMessageIds?.get(index);
        const created = {
          actionIndex: index,
          streamed: Boolean(streamedMessageId),
          message: await this.messages.save({
            ownerUserId: input.ownerUserId,
            id: streamedMessageId ?? createId("msg"),
            conversationId: input.conversationId,
            role: "assistant",
            contentType: toMessageContentType(action.message),
            content: toMessageContent(
              action.message,
              input.agent,
              voiceMedia,
              imageMedia,
            ),
            status,
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
        };
        createdMessages.push(created);
        publishPacedMessage(created);
        void import("../../../channels/wechat.service.js").then(
          ({ WechatService }) =>
            new WechatService()
              .deliver(created.message)
              .catch((error) => console.warn("微信回复投递失败", error)),
        );
      }
      const deliveredMessages = createdMessages.filter(
        (created) => created.message.status !== "failed",
      );
      const lastDeliveredMessage = deliveredMessages.at(-1);
      if (lastDeliveredMessage) {
        const lastMessageAction =
          decision.actions[lastDeliveredMessage.actionIndex];
        if (
          lastMessageAction?.type === "send_message" ||
          (lastMessageAction?.type === "transfer" &&
            lastMessageAction.operation === "send")
        ) {
          await this.conversations.updatePreview({
            ownerUserId: input.ownerUserId,
            conversationId: input.conversationId,
            preview:
              lastMessageAction.type === "send_message"
                ? toConversationPreview(lastMessageAction.message)
                : `[转账] ¥${lastMessageAction.amount.toFixed(2)}`,
            updatedAt: input.paceUnstreamedMessages
              ? lastDeliveredMessage.message.createdAt
              : now + lastDeliveredMessage.actionIndex,
            unreadIncrement: deliveredMessages.length,
          });
        }
      }

      const latestState = this.states.findByAgent
        ? await this.states.findByAgent(input.ownerUserId, input.agent.id)
        : null;
      if (latestState) syncWakeupState(state, latestState);

      for (const created of deliveredMessages) {
        if (
          state.proactiveWakeup &&
          created.message.sequence !== undefined &&
          invalidatesProactiveWakeup(
            state.proactiveWakeup,
            created.message.sequence,
            created.message.createdAt,
          )
        )
          delete state.proactiveWakeup;
      }

      const proactiveBeforeDecision = state.proactiveWakeup;
      if (
        trigger === "scheduled_wakeup" &&
        proactiveBeforeDecision?.token === input.wakeupToken
      )
        delete state.proactiveWakeup;

      const scheduleWakeupAction = [...decision.actions]
        .reverse()
        .find((action) => action.type === "schedule_wakeup");
      const interactionBaselineSequence = Math.max(
        input.interactionBaselineSequence ?? 0,
        ...createdMessages.map((created) => created.message.sequence ?? 0),
      );
      if (
        wakeups.proactive.enabled &&
        scheduleWakeupAction?.type === "schedule_wakeup"
      ) {
        if (scheduleWakeupAction.afterMinutes === null) {
          delete state.proactiveWakeup;
        } else {
          state.proactiveWakeup = {
            token: createId("wake"),
            scheduledAtMs: now,
            dueAtMs: now + scheduleWakeupAction.afterMinutes * 60_000,
            interactionAfterSequence: interactionBaselineSequence,
            interactionInvalidationWindowMinutes:
              wakeups.proactive.interactionInvalidationWindowMinutes,
          };
          delete state.passiveWakeup;
          delete state.passiveWakeupExhaustedAfterEndUserSequence;
        }
      }

      state.lastFigureActivityAtMs = now;
      applyPassiveWakeupAfterDecision({
        state,
        trigger,
        wakeups,
        wakeupToken: input.wakeupToken,
        passiveStage: input.passiveStage,
        baselineEndUserSequence: input.inputThroughEndUserSeq ?? 0,
        now,
        explicitlyCancelledProactive:
          scheduleWakeupAction?.type === "schedule_wakeup" &&
          scheduleWakeupAction.afterMinutes === null,
      });

      await this.states.save(input.ownerUserId, input.agent.id, state);
      if (muteChanged)
        this.appPush.pushToUser(input.ownerUserId, {
          type: "conversation.agent_mute_changed",
          conversationId: input.conversationId,
          muteUntilMs:
            state.silenceUntilMs && state.silenceUntilMs > now
              ? state.silenceUntilMs
              : null,
          updatedAt: now,
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
        cause: error,
      });
      throw error;
    }

    if (!input.paceUnstreamedMessages)
      for (const created of createdMessages)
        this.appPush.pushToUser(input.ownerUserId, {
          type: created.streamed ? "message.completed" : "message.created",
          message: created.message,
        });
    for (const message of updatedTransferMessages)
      this.appPush.pushToUser(input.ownerUserId, {
        type: "message.updated",
        message,
      });
    return state;
  }
}

function timedMessageText(message: PrimeFigureOutgoingMessage) {
  if (message.type === "text") return message.text;
  if (message.type === "voice") return message.transcript;
  return undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function syncWakeupState(target: PrimeFigureState, source: PrimeFigureState) {
  target.proactiveWakeup = source.proactiveWakeup;
  target.passiveWakeup = source.passiveWakeup;
  target.passiveWakeupExhaustedAfterEndUserSequence =
    source.passiveWakeupExhaustedAfterEndUserSequence;
}

function applyPassiveWakeupAfterDecision(input: {
  state: PrimeFigureState;
  trigger: PrimeDecisionTrigger;
  wakeups: StoredPrimeFigureRuntimeConfig["wakeups"];
  wakeupToken?: string;
  passiveStage?: 1 | 2 | 3;
  baselineEndUserSequence: number;
  now: number;
  explicitlyCancelledProactive: boolean;
}) {
  const { state } = input;
  if (
    input.trigger !== "passive_wakeup" &&
    state.passiveWakeup &&
    input.baselineEndUserSequence > state.passiveWakeup.baselineEndUserSequence
  )
    delete state.passiveWakeup;
  if (
    state.passiveWakeupExhaustedAfterEndUserSequence !== undefined &&
    input.baselineEndUserSequence >
      state.passiveWakeupExhaustedAfterEndUserSequence
  )
    delete state.passiveWakeupExhaustedAfterEndUserSequence;
  if (!input.wakeups.passive.enabled) {
    delete state.passiveWakeup;
    delete state.passiveWakeupExhaustedAfterEndUserSequence;
    return;
  }
  if (state.proactiveWakeup) {
    delete state.passiveWakeup;
    return;
  }

  if (input.trigger === "passive_wakeup") {
    const current = state.passiveWakeup;
    if (
      !current ||
      current.token !== input.wakeupToken ||
      current.stage !== input.passiveStage
    )
      return;
    if (current.stage === 3) {
      delete state.passiveWakeup;
      state.passiveWakeupExhaustedAfterEndUserSequence =
        input.baselineEndUserSequence;
      return;
    }
    const nextStage = (current.stage + 1) as 2 | 3;
    const waitMinutes =
      current.milestonesMinutes[nextStage - 1] -
      current.milestonesMinutes[current.stage - 1];
    state.passiveWakeup = {
      token: createId("wake"),
      stage: nextStage,
      anchorActivityAtMs: input.now,
      dueAtMs: input.now + waitMinutes * 60_000,
      baselineEndUserSequence: input.baselineEndUserSequence,
      milestonesMinutes: current.milestonesMinutes,
    };
    return;
  }

  const activeWakeupCompleted =
    input.trigger === "scheduled_wakeup" || input.explicitlyCancelledProactive;
  if (activeWakeupCompleted) {
    delete state.passiveWakeupExhaustedAfterEndUserSequence;
    startPassiveWakeup(input);
    return;
  }

  if (
    !state.passiveWakeup &&
    state.passiveWakeupExhaustedAfterEndUserSequence === undefined
  )
    startPassiveWakeup(input);
}

function startPassiveWakeup(input: {
  state: PrimeFigureState;
  wakeups: StoredPrimeFigureRuntimeConfig["wakeups"];
  baselineEndUserSequence: number;
  now: number;
}) {
  const milestones = input.wakeups.passive.milestonesMinutes;
  input.state.passiveWakeup = {
    token: createId("wake"),
    stage: 1,
    anchorActivityAtMs: input.now,
    dueAtMs: input.now + milestones[0] * 60_000,
    baselineEndUserSequence: input.baselineEndUserSequence,
    milestonesMinutes: [...milestones],
  };
}

const DEFAULT_WAKEUP_CONFIG: StoredPrimeFigureRuntimeConfig["wakeups"] = {
  proactive: {
    enabled: false,
    interactionInvalidationWindowMinutes: 10,
  },
  passive: {
    enabled: false,
    milestonesMinutes: [15, 180, 1_440],
  },
};

function toPrimeMessageContent(
  message: PrimeFigureOutgoingMessage,
  agent: PrimeFigureAgent,
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
  if (message.type === "sticker") {
    const sticker = (agent.detail.stickers ?? []).find(
      (item) => item.resourceId === message.stickerId,
    );
    if (!sticker) throw new Error("figure 选择的表情不在可用列表中。");
    return {
      type: "sticker",
      stickerId: sticker.resourceId,
      description: sticker.description,
      resourceId: sticker.resourceId,
      resourceUrl: sticker.resourcePath,
    };
  }
  return message;
}

function toMessageContentType(
  message: PrimeFigureOutgoingMessage,
): MessageContentType {
  return message.type === "sticker" ? "image" : message.type;
}

function toMessageContent(
  message: PrimeFigureOutgoingMessage,
  agent: PrimeFigureAgent,
  voiceMedia?: ResolvedPrimeVoiceMedia,
  imageMedia?: ResolvedPrimeImageMedia,
): MessageContent {
  if (message.type === "text") return { text: message.text };
  if (message.type === "image")
    return {
      text: message.description,
      ...(imageMedia
        ? {
            mediaUrl: imageMedia.mediaUrl,
            resourceId: imageMedia.resourceId,
            media: createVisualMediaReference({
              resourceId: imageMedia.resourceId,
              kind: "image",
              variants: ["thumb", "display", "original"],
            }),
          }
        : {}),
    };
  if (message.type === "sticker") {
    const sticker = (agent.detail.stickers ?? []).find(
      (item) => item.resourceId === message.stickerId,
    );
    if (!sticker) throw new Error("figure 选择的表情不在可用列表中。");
    return {
      mediaUrl: sticker.resourcePath,
      resourceId: sticker.resourceId,
      media: createVisualMediaReference({
        resourceId: sticker.resourceId,
        kind: "sticker",
        variants: ["thumb", "display", "original"],
      }),
    };
  }
  return {
    text: message.transcript,
    ...(voiceMedia
      ? {
          mediaUrl: voiceMedia.mediaUrl,
          resourceId: voiceMedia.resourceId,
          media: {
            resourceId: voiceMedia.resourceId,
            kind: "voice" as const,
            variants: ["original" as const],
          },
        }
      : {}),
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
        ...(voiceMedia ? { durationSeconds: voiceMedia.durationSeconds } : {}),
        ...(ttsError ? { error: ttsError } : {}),
      },
    };
  }
  return {};
}

function toConversationPreview(message: PrimeFigureOutgoingMessage) {
  if (message.type === "text") return message.text;
  if (message.type === "image") return `[图片] ${message.description}`;
  if (message.type === "sticker") return "[表情]";
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
  return [...state.memories, ...writes];
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
