import { randomUUID } from "node:crypto";
import { primeFigureDecisionSchema } from "@echoo/shared";
import type {
  Message,
  PrimeFigureAgent,
  PrimeFigureDecision,
  PrimeFigureState,
  PrimeFigureVariableValue,
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
    const createdMessages: Message[] = [];

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
          const primeMessage = this.primeMessages.save({
            ownerUserId: input.ownerUserId,
            agentId: input.agent.id,
            conversationId: input.conversationId,
            sender: "prime_figure",
            direction: "outgoing",
            content: action.message,
            occurredAtMs,
            timezone: input.agent.detail.schedule.timezone,
          });
          createdMessages.push(
            this.messages.save({
              ownerUserId: input.ownerUserId,
              id: `msg_${randomUUID()}`,
              conversationId: input.conversationId,
              role: "assistant",
              contentType: "text",
              content: { text: action.message.text },
              status: "delivered",
              providerId: input.providerId,
              model: input.model,
              metadata: {
                kind: "prime_figure",
                primeMessageId: primeMessage.id,
              },
              createdAt: occurredAtMs,
              updatedAt: occurredAtMs,
            }),
          );
        });
        const lastMessage = decision.actions.at(-1);
        if (lastMessage?.type !== "send_message")
          throw new Error("Prime Figure send action list is invalid.");
        this.conversations.updatePreview({
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          preview: lastMessage.message.text,
          updatedAt: now + decision.actions.length - 1,
          unreadIncrement: decision.actions.length,
        });
      } else {
        state.silenceStartedAtMs = now;
        state.silenceUntilMs =
          now + silenceAction.revisitAfterMinutes * 60_000;
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
          error instanceof Error
            ? error.message
            : "Prime decision execution failed.",
      });
      throw error;
    }

    for (const createdMessage of createdMessages)
      this.appPush.pushToUser(input.ownerUserId, {
        type: "message.created",
        message: createdMessage,
      });
    return state;
  }
}

function appendMemories(
  state: PrimeFigureState,
  decision: PrimeFigureDecision,
  timezone: string,
  now: number,
) {
  const writes = decision.memoryWrites.map((memory) => ({
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
      if (definition.required)
        throw new Error(
          `Required Prime Figure variable is missing: ${definition.key}`,
        );
      if (current[definition.key] !== undefined)
        next[definition.key] = current[definition.key];
      continue;
    }

    if (definition.type === "string") {
      if (typeof value !== "string")
        throw new Error(`Variable ${definition.key} must be a string.`);
      next[definition.key] = value;
      continue;
    }
    if (definition.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`Variable ${definition.key} must be a finite number.`);
      next[definition.key] = Math.min(
        Math.max(value, definition.min ?? Number.NEGATIVE_INFINITY),
        definition.max ?? Number.POSITIVE_INFINITY,
      );
      continue;
    }
    if (definition.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`Variable ${definition.key} must be a boolean.`);
      next[definition.key] = value;
      continue;
    }

    if (typeof value === "string") {
      try {
        next[definition.key] = JSON.parse(value) as PrimeFigureVariableValue;
      } catch {
        throw new Error(`Variable ${definition.key} must contain valid JSON.`);
      }
    } else {
      next[definition.key] = value;
    }
  }

  return next;
}
