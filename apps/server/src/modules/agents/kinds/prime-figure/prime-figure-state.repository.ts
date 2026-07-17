import type {
  CreatePrimeFigureRequest,
  PrimeFigurePassiveWakeup,
  PrimeFigureProactiveWakeup,
  PrimeFigureState,
  PrimeFigureVariableValue,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../../../infra/database/mysql.js";
import { AgentRepository } from "../../agent.repository.js";
import { ChangeEventRepository } from "../../../sync/change-event.repository.js";
import { syncScheduledRuns } from "./scheduled-run.repository.js";

export interface DuePrimeFigureWakeup {
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  trigger?: "scheduled_wakeup" | "passive_wakeup" | "mute_ended";
  muteEnded: boolean;
  wakeupToken?: string;
  passiveStage?: 1 | 2 | 3;
}
interface StateRow extends RowDataPacket {
  runtime_state: unknown;
}
interface DueRow extends RowDataPacket {
  owner_user_id: string;
  agent_id: string;
  conversation_id: string;
  runtime_state: unknown;
}
interface ConversationStateRow extends RowDataPacket {
  owner_user_id: string;
  agent_id: string;
  runtime_state: unknown;
}

const WAKEUP_LEASE_MS = 10 * 60_000;
const MAX_WAKEUP_DELIVERY_ATTEMPTS = 3;

export class PrimeFigureStateRepository {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly events = new ChangeEventRepository(),
  ) {}
  async createInitial(input: {
    ownerUserId: string;
    agentId: string;
    figure: CreatePrimeFigureRequest;
    now: number;
  }) {
    const variables: Record<string, PrimeFigureVariableValue> = {};
    for (const definition of input.figure.variableDefinitions ?? [])
      if (definition.defaultValue !== undefined)
        variables[definition.key] = definition.defaultValue;
    await this.save(input.ownerUserId, input.agentId, {
      variables,
      memories: [],
      currentSituation: input.figure.currentSituation ?? "",
      schedule: { segments: input.figure.schedule?.segments ?? [] },
      itinerary: input.figure.itinerary ?? "",
      mood: input.figure.initialMood ?? "",
      moodObservedAtMs: input.now,
      relationshipStatus: input.figure.initialRelationshipStatus ?? "",
      updatedAt: input.now,
    });
  }
  async findByAgent(ownerUserId: string, agentId: string) {
    return this.agents.getRuntimeState<PrimeFigureState>(ownerUserId, agentId);
  }
  async save(ownerUserId: string, agentId: string, state: PrimeFigureState) {
    await this.agents.saveRuntimeState(
      ownerUserId,
      agentId,
      state,
      nextPrimeRunAt(state),
    );
  }
  async reconcileVariables(
    ownerUserId: string,
    agentId: string,
    figure: Pick<CreatePrimeFigureRequest, "variableDefinitions">,
  ) {
    const state = await this.findByAgent(ownerUserId, agentId);
    if (!state) return;
    const variables: Record<string, PrimeFigureVariableValue> = {};
    for (const definition of figure.variableDefinitions ?? []) {
      if (state.variables[definition.key] !== undefined)
        variables[definition.key] = state.variables[definition.key]!;
      else if (definition.defaultValue !== undefined)
        variables[definition.key] = definition.defaultValue;
    }
    await this.save(ownerUserId, agentId, {
      ...state,
      variables,
      updatedAt: Date.now(),
    });
  }
  async claimDueWakeups(
    now: number,
    limit = 100,
  ): Promise<DuePrimeFigureWakeup[]> {
    return withTransaction(async (connection) => {
      const rows = await queryRows<DueRow>(
        `SELECT agents.owner_user_id, agents.id AS agent_id,
          conversations.id AS conversation_id, runtime.state_json AS runtime_state
         FROM scheduled_runs scheduled
         JOIN conversations ON conversations.id = scheduled.conversation_id
         JOIN agents ON agents.id = conversations.agent_id
         JOIN agent_runtime_states runtime ON runtime.agent_id = agents.id
         WHERE agents.type = 'prime-figure' AND scheduled.due_at <= ?
         ORDER BY scheduled.due_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
        [now, Math.min(Math.max(Math.trunc(limit), 1), 500)],
        connection,
      );
      const due: DuePrimeFigureWakeup[] = [];
      const claimedConversations = new Set<string>();
      for (const row of rows) {
        if (claimedConversations.has(row.conversation_id)) continue;
        claimedConversations.add(row.conversation_id);
        const state = parseJson<PrimeFigureState>(
          row.runtime_state,
          null as never,
        );
        if (!state) continue;
        let event: Omit<DuePrimeFigureWakeup, "muteEnded"> | undefined;
        let muteEnded = false;

        if (isWakeupDue(state.proactiveWakeup, now)) {
          const wakeup = state.proactiveWakeup!;
          const attempts = wakeup.lease?.deliveryAttempts ?? 0;
          if (
            attempts >= MAX_WAKEUP_DELIVERY_ATTEMPTS ||
            (await hasProactiveInvalidatingInteraction(
              row.conversation_id,
              wakeup,
              connection,
            ))
          ) {
            delete state.proactiveWakeup;
          } else {
            state.proactiveWakeup = withLease(wakeup, now, attempts + 1);
            event = {
              ownerUserId: row.owner_user_id,
              agentId: row.agent_id,
              conversationId: row.conversation_id,
              trigger: "scheduled_wakeup",
              wakeupToken: wakeup.token,
            };
          }
        }

        if (!event && isWakeupDue(state.passiveWakeup, now)) {
          const wakeup = state.passiveWakeup!;
          const attempts = wakeup.lease?.deliveryAttempts ?? 0;
          if (
            attempts >= MAX_WAKEUP_DELIVERY_ATTEMPTS ||
            (await hasNewEndUserMessage(
              row.conversation_id,
              wakeup.baselineEndUserSequence,
              connection,
            ))
          ) {
            delete state.passiveWakeup;
          } else {
            state.passiveWakeup = withLease(wakeup, now, attempts + 1);
            event = {
              ownerUserId: row.owner_user_id,
              agentId: row.agent_id,
              conversationId: row.conversation_id,
              trigger: "passive_wakeup",
              wakeupToken: wakeup.token,
              passiveStage: wakeup.stage,
            };
          }
        }

        if (state.silenceUntilMs && state.silenceUntilMs <= now) {
          muteEnded = true;
          const hadQueuedMessages = await hasQueuedMuteMessages(
            row.conversation_id,
            state.silenceStartedAtMs ?? 0,
            connection,
          );
          delete state.silenceStartedAtMs;
          delete state.silenceUntilMs;
          if (!event && hadQueuedMessages)
            event = {
              ownerUserId: row.owner_user_id,
              agentId: row.agent_id,
              conversationId: row.conversation_id,
              trigger: "mute_ended",
            };
        }

        state.updatedAt = now;
        const { memories: _memories, ...storedState } = state;
        await execute(
          `UPDATE agent_runtime_states SET state_json = ?, version = version + 1, updated_at = ?
           WHERE agent_id = ? AND conversation_id = ?`,
          [JSON.stringify(storedState), now, row.agent_id, row.conversation_id],
          connection,
        );
        await syncScheduledRuns(connection, {
          ownerUserId: row.owner_user_id,
          conversationId: row.conversation_id,
          state,
          now,
        });
        if (muteEnded)
          await this.events.append(
            {
              ownerUserId: row.owner_user_id,
              entityType: "agent",
              entityId: row.agent_id,
              conversationId: row.conversation_id,
              operation: "upsert",
              createdAt: now,
            },
            connection,
          );
        if (event || muteEnded)
          due.push({
            ownerUserId: row.owner_user_id,
            agentId: row.agent_id,
            conversationId: row.conversation_id,
            ...event,
            muteEnded,
          });
      }
      return due;
    });
  }

  async nextDueAt() {
    const row = await queryOne<RowDataPacket & { due_at: number | null }>(
      "SELECT MIN(due_at) AS due_at FROM scheduled_runs",
    );
    return row?.due_at === null || row?.due_at === undefined
      ? null
      : Number(row.due_at);
  }

  async recordMessageInteraction(input: {
    ownerUserId: string;
    conversationId: string;
    role: "user" | "assistant";
    sequence: number;
    occurredAtMs: number;
  }) {
    await withTransaction(async (connection) => {
      const row = await queryOne<ConversationStateRow>(
        `SELECT agents.owner_user_id, agents.id AS agent_id, runtime.state_json AS runtime_state
         FROM agents JOIN conversations ON conversations.agent_id = agents.id
         JOIN agent_runtime_states runtime ON runtime.agent_id = agents.id
         WHERE agents.type = 'prime-figure' AND agents.owner_user_id = ?
          AND conversations.id = ? FOR UPDATE`,
        [input.ownerUserId, input.conversationId],
        connection,
      );
      if (!row) return;
      const state = parseJson<PrimeFigureState>(
        row.runtime_state,
        null as never,
      );
      if (!state) return;
      let changed = false;
      if (input.role === "user") {
        changed = Boolean(
          state.passiveWakeup ||
          state.passiveWakeupExhaustedAfterEndUserSequence !== undefined,
        );
        delete state.passiveWakeup;
        delete state.passiveWakeupExhaustedAfterEndUserSequence;
      }
      if (
        state.proactiveWakeup &&
        invalidatesProactiveWakeup(
          state.proactiveWakeup,
          input.sequence,
          input.occurredAtMs,
        )
      ) {
        delete state.proactiveWakeup;
        changed = true;
      }
      if (!changed) return;
      state.updatedAt = Date.now();
      const { memories: _memories, ...storedState } = state;
      await execute(
        `UPDATE agent_runtime_states SET state_json = ?, version = version + 1, updated_at = ?
         WHERE owner_user_id = ? AND conversation_id = ?`,
        [
          JSON.stringify(storedState),
          state.updatedAt,
          input.ownerUserId,
          input.conversationId,
        ],
        connection,
      );
      await syncScheduledRuns(connection, {
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        state,
        now: state.updatedAt,
      });
    });
  }

  async clearWakeup(input: {
    ownerUserId: string;
    agentId: string;
    kind: "proactive" | "passive";
    token?: string;
  }) {
    const state = await this.findByAgent(input.ownerUserId, input.agentId);
    if (!state) return;
    const wakeup =
      input.kind === "proactive" ? state.proactiveWakeup : state.passiveWakeup;
    if (!wakeup || (input.token && wakeup.token !== input.token)) return;
    if (input.kind === "proactive") delete state.proactiveWakeup;
    else delete state.passiveWakeup;
    state.updatedAt = Date.now();
    await this.save(input.ownerUserId, input.agentId, state);
  }

  async clearDisabledWakeupsForOwner(input: {
    ownerUserId: string;
    proactive: boolean;
    passive: boolean;
  }) {
    if (!input.proactive && !input.passive) return;
    const rows = await queryRows<ConversationStateRow>(
      `SELECT agents.owner_user_id, agents.id AS agent_id, runtime.state_json AS runtime_state
       FROM agents JOIN conversations ON conversations.agent_id = agents.id
       JOIN agent_runtime_states runtime ON runtime.agent_id = agents.id
       LEFT JOIN conversation_runtime_configs configs
        ON configs.conversation_id = conversations.id
       WHERE agents.type = 'prime-figure' AND agents.owner_user_id = ?
        AND (configs.mode IS NULL OR configs.mode = 'global')`,
      [input.ownerUserId],
    );
    for (const row of rows)
      await this.clearWakeupFields(row, input.proactive, input.passive);
  }

  async clearDisabledWakeupsForConversation(input: {
    ownerUserId: string;
    conversationId: string;
    proactive: boolean;
    passive: boolean;
  }) {
    if (!input.proactive && !input.passive) return;
    const row = await queryOne<ConversationStateRow>(
      `SELECT agents.owner_user_id, agents.id AS agent_id, runtime.state_json AS runtime_state
       FROM agents JOIN conversations ON conversations.agent_id = agents.id
       JOIN agent_runtime_states runtime ON runtime.agent_id = agents.id
       WHERE agents.type = 'prime-figure' AND agents.owner_user_id = ?
        AND conversations.id = ?`,
      [input.ownerUserId, input.conversationId],
    );
    if (row) await this.clearWakeupFields(row, input.proactive, input.passive);
  }

  private async clearWakeupFields(
    row: ConversationStateRow,
    proactive: boolean,
    passive: boolean,
  ) {
    const state = parseJson<PrimeFigureState>(row.runtime_state, null as never);
    if (!state) return;
    const changed = Boolean(
      (proactive && state.proactiveWakeup) ||
      (passive &&
        (state.passiveWakeup ||
          state.passiveWakeupExhaustedAfterEndUserSequence !== undefined)),
    );
    if (!changed) return;
    if (proactive) delete state.proactiveWakeup;
    if (passive) {
      delete state.passiveWakeup;
      delete state.passiveWakeupExhaustedAfterEndUserSequence;
    }
    state.updatedAt = Date.now();
    await this.save(row.owner_user_id, row.agent_id, state);
  }
}

export function nextPrimeRunAt(state: PrimeFigureState) {
  const values = [
    state.silenceUntilMs,
    wakeupNextRunAt(state.proactiveWakeup),
    wakeupNextRunAt(state.passiveWakeup),
  ].filter((value): value is number => typeof value === "number");
  return values.length ? Math.min(...values) : null;
}

export function invalidatesProactiveWakeup(
  wakeup: PrimeFigureProactiveWakeup,
  sequence: number,
  occurredAtMs: number,
) {
  const windowStartsAt =
    wakeup.dueAtMs - wakeup.interactionInvalidationWindowMinutes * 60_000;
  return (
    sequence > wakeup.interactionAfterSequence &&
    occurredAtMs >= windowStartsAt &&
    occurredAtMs <= wakeup.dueAtMs
  );
}

function wakeupNextRunAt(
  wakeup: PrimeFigureProactiveWakeup | PrimeFigurePassiveWakeup | undefined,
) {
  return wakeup?.lease?.leaseUntilMs ?? wakeup?.dueAtMs;
}

function isWakeupDue(
  wakeup: PrimeFigureProactiveWakeup | PrimeFigurePassiveWakeup | undefined,
  now: number,
) {
  return Boolean(
    wakeup && (wakeup.lease?.leaseUntilMs ?? wakeup.dueAtMs) <= now,
  );
}

function withLease<
  T extends PrimeFigureProactiveWakeup | PrimeFigurePassiveWakeup,
>(wakeup: T, now: number, deliveryAttempts: number): T {
  return {
    ...wakeup,
    lease: { leaseUntilMs: now + WAKEUP_LEASE_MS, deliveryAttempts },
  };
}

async function hasProactiveInvalidatingInteraction(
  conversationId: string,
  wakeup: PrimeFigureProactiveWakeup,
  connection: Parameters<typeof queryOne>[2],
) {
  const row = await queryOne<RowDataPacket>(
    `SELECT seq FROM messages WHERE conversation_id = ? AND seq > ?
      AND role IN ('user', 'assistant') AND status != 'failed'
      AND created_at >= ? AND created_at <= ? LIMIT 1`,
    [
      conversationId,
      wakeup.interactionAfterSequence,
      wakeup.dueAtMs - wakeup.interactionInvalidationWindowMinutes * 60_000,
      wakeup.dueAtMs,
    ],
    connection,
  );
  return Boolean(row);
}

async function hasNewEndUserMessage(
  conversationId: string,
  baselineSequence: number,
  connection: Parameters<typeof queryOne>[2],
) {
  return Boolean(
    await queryOne<RowDataPacket>(
      `SELECT seq FROM messages WHERE conversation_id = ? AND role = 'user'
        AND seq > ? LIMIT 1`,
      [conversationId, baselineSequence],
      connection,
    ),
  );
}

async function hasQueuedMuteMessages(
  conversationId: string,
  silenceStartedAtMs: number,
  connection: Parameters<typeof queryOne>[2],
) {
  return Boolean(
    await queryOne<RowDataPacket>(
      `SELECT seq FROM messages WHERE conversation_id = ? AND role = 'user'
        AND created_at > ? LIMIT 1`,
      [conversationId, silenceStartedAtMs],
      connection,
    ),
  );
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
