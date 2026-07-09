import { randomUUID } from "node:crypto";
import { primeFigureActionSchema } from "@echoo/shared";
import type { PrimeFigureAction, PrimeFigureAgent, PrimeFigureDecision, PrimeFigureState, PrimeFigureVariableValue, PrimeMessageContent } from "@echoo/shared";
import { ConversationRepository } from "../../../conversations/conversation.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";

export class PrimeActionExecutor {
  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly messages = new PrimeMessageRepository(),
    private readonly logs = new PrimeActionLogRepository(),
    private readonly conversations = new ConversationRepository()
  ) {}

  executeDecision(input: {
    ownerUserId: string;
    conversationId: string;
    agent: PrimeFigureAgent;
    state: PrimeFigureState;
    decision: PrimeFigureDecision;
  }) {
    const now = Date.now();
    const state = { ...input.state, updatedAt: now };
    const memoryActions: PrimeFigureAction[] = input.decision.memoryWrites.map((memory) => ({
      type: "upsert_memory",
      content: memory.content,
      importance: memory.importance,
      sourceMessageIds: memory.sourceMessageIds,
      actionRationale: "Persisted from decision memoryWrites."
    }));

    for (const action of [...memoryActions, ...input.decision.actions]) {
      this.executeAction({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        agent: input.agent,
        state,
        action
      });
    }

    if (input.decision.nextWakeupAtMs !== undefined) {
      state.nextWakeupAtMs = input.decision.nextWakeupAtMs;
    }

    state.updatedAt = Date.now();
    this.states.save(input.ownerUserId, input.agent.id, state);
    return state;
  }

  private executeAction(input: {
    ownerUserId: string;
    conversationId: string;
    agent: PrimeFigureAgent;
    state: PrimeFigureState;
    action: PrimeFigureAction;
  }) {
    const parsed = primeFigureActionSchema.parse(input.action);

    try {
      switch (parsed.type) {
        case "send_message": {
          const occurredAtMs = Date.now() + Math.round((parsed.delayMinutes ?? 0) * 60_000);
          const message = this.messages.save({
            ownerUserId: input.ownerUserId,
            agentId: input.agent.id,
            conversationId: input.conversationId,
            sender: "prime_figure",
            direction: "outgoing",
            content: parsed.message,
            occurredAtMs
          });
          this.conversations.updatePreview({
            ownerUserId: input.ownerUserId,
            conversationId: input.conversationId,
            preview: describeContent(parsed.message),
            updatedAt: message.updatedAt,
            incrementUnread: true
          });
          break;
        }
        case "schedule_message":
          input.state.nextWakeupAtMs = parsed.sendAtMs;
          break;
        case "update_schedule":
          input.state.currentSchedule = { ...input.state.currentSchedule, ...parsed.patch };
          break;
        case "update_itinerary":
          input.state.itinerary = { ...input.state.itinerary, ...parsed.patch };
          break;
        case "mutate_variable":
          input.state.variables[parsed.key] = mutateVariable(input.agent, input.state.variables[parsed.key], parsed);
          break;
        case "upsert_memory":
          input.state.memories = [
            ...input.state.memories,
            {
              id: `pmem_${randomUUID()}`,
              content: parsed.content,
              importance: parsed.importance,
              sourceMessageIds: parsed.sourceMessageIds,
              createdAt: Date.now()
            }
          ].slice(-1000);
          break;
        case "silence":
          if (parsed.revisitAfterMinutes !== undefined) {
            input.state.nextWakeupAtMs = Date.now() + Math.round(parsed.revisitAfterMinutes * 60_000);
          }
          break;
      }

      this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: input.agent.id,
        conversationId: input.conversationId,
        action: parsed,
        status: "applied"
      });
    } catch (error) {
      this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: input.agent.id,
        conversationId: input.conversationId,
        action: parsed,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Prime action failed."
      });
    }
  }
}

function mutateVariable(
  agent: PrimeFigureAgent,
  currentValue: PrimeFigureVariableValue | undefined,
  action: Extract<PrimeFigureAction, { type: "mutate_variable" }>
): PrimeFigureVariableValue {
  const definition = agent.detail.variableDefinitions.find((item) => item.key === action.key);
  if (definition && !definition.llmWritable) throw new Error(`Variable is not writable: ${action.key}`);

  if (action.operation === "set") return clampNumberIfNeeded(action.value, definition?.min, definition?.max);

  const current = typeof currentValue === "number" ? currentValue : 0;
  const delta = typeof action.value === "number" ? action.value : Number(action.value);
  if (!Number.isFinite(delta)) throw new Error(`Variable delta must be numeric: ${action.key}`);

  return clampNumberIfNeeded(action.operation === "increment" ? current + delta : current - delta, definition?.min, definition?.max);
}

function clampNumberIfNeeded(value: PrimeFigureVariableValue, min?: number, max?: number) {
  if (typeof value !== "number") return value;
  return Math.min(Math.max(value, min ?? Number.NEGATIVE_INFINITY), max ?? Number.POSITIVE_INFINITY);
}

function describeContent(content: PrimeMessageContent) {
  if (content.type === "text") return content.text;
  if (content.type === "image") return content.description;
  if (content.type === "video") return content.description;
  if (content.type === "voice") return content.transcript;
  if (content.type === "sticker") return content.description;
  return `${content.direction === "received" ? "Received" : "Paid"} ${content.currency} ${content.amount}`;
}
