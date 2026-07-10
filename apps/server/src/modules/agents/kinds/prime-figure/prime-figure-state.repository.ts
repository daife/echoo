import type {
  CreatePrimeFigureRequest,
  PrimeFigureMemory,
  PrimeFigureState,
  PrimeFigureVariableValue,
} from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

interface PrimeFigureStateRow {
  agent_id: string;
  owner_user_id: string;
  variables_json: string;
  memories_json: string;
  mood: string;
  mood_observed_at_ms: number;
  relationship_status: string;
  silence_started_at_ms: number | null;
  silence_until_ms: number | null;
  created_at: number;
  updated_at: number;
}

export interface DuePrimeFigureSilence {
  ownerUserId: string;
  agentId: string;
  conversationId: string;
  hadQueuedMessages: boolean;
}

export class PrimeFigureStateRepository {
  private readonly db = getDatabase();

  createInitial(input: {
    ownerUserId: string;
    agentId: string;
    figure: CreatePrimeFigureRequest;
    now: number;
  }) {
    const variables = buildInitialVariables(input.figure);

    this.db
      .prepare(
        `
          INSERT INTO prime_figure_states (
            agent_id,
            owner_user_id,
            variables_json,
            memories_json,
            mood,
            mood_observed_at_ms,
            relationship_status,
            silence_started_at_ms,
            silence_until_ms,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.agentId,
        input.ownerUserId,
        JSON.stringify(variables),
        JSON.stringify([]),
        input.figure.initialMood ?? "",
        input.now,
        input.figure.initialRelationshipStatus ?? "",
        null,
        null,
        input.now,
        input.now,
      );
  }

  findByAgent(ownerUserId: string, agentId: string): PrimeFigureState | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM prime_figure_states
          WHERE owner_user_id = ? AND agent_id = ?
        `,
      )
      .get(ownerUserId, agentId) as PrimeFigureStateRow | undefined;

    return row ? rowToState(row) : null;
  }

  save(ownerUserId: string, agentId: string, state: PrimeFigureState) {
    this.db
      .prepare(
        `
          UPDATE prime_figure_states
          SET
            variables_json = ?,
            memories_json = ?,
            mood = ?,
            mood_observed_at_ms = ?,
            relationship_status = ?,
            silence_started_at_ms = ?,
            silence_until_ms = ?,
            updated_at = ?
          WHERE owner_user_id = ? AND agent_id = ?
        `,
      )
      .run(
        JSON.stringify(state.variables),
        JSON.stringify(state.memories),
        state.mood,
        state.moodObservedAtMs,
        state.relationshipStatus,
        state.silenceStartedAtMs ?? null,
        state.silenceUntilMs ?? null,
        state.updatedAt,
        ownerUserId,
        agentId,
      );
  }

  reconcileVariables(
    ownerUserId: string,
    agentId: string,
    figure: Pick<CreatePrimeFigureRequest, "variableDefinitions">,
  ) {
    const state = this.findByAgent(ownerUserId, agentId);
    if (!state) return;

    const nextVariables: Record<string, PrimeFigureVariableValue> = {};
    for (const definition of figure.variableDefinitions ?? []) {
      const current = state.variables[definition.key];
      if (current !== undefined) nextVariables[definition.key] = current;
      else if (definition.defaultValue !== undefined)
        nextVariables[definition.key] = definition.defaultValue;
    }

    this.save(ownerUserId, agentId, {
      ...state,
      variables: nextVariables,
      updatedAt: Date.now(),
    });
  }

  claimDueSilences(now: number, limit = 100): DuePrimeFigureSilence[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            states.owner_user_id,
            states.agent_id,
            states.silence_started_at_ms,
            conversations.id AS conversation_id,
            EXISTS (
              SELECT 1
              FROM prime_messages queued
              WHERE queued.owner_user_id = states.owner_user_id
                AND queued.agent_id = states.agent_id
                AND queued.sender = 'end_user'
                AND queued.occurred_at_ms > COALESCE(states.silence_started_at_ms, 0)
            ) AS had_queued_messages
          FROM prime_figure_states states
          JOIN conversations ON conversations.agent_id = states.agent_id
          WHERE states.silence_until_ms IS NOT NULL
            AND states.silence_until_ms <= ?
          ORDER BY states.silence_until_ms ASC
          LIMIT ?
        `,
      )
      .all(
        now,
        Math.min(Math.max(Math.trunc(limit), 1), 500),
      ) as unknown as Array<{
      owner_user_id: string;
      agent_id: string;
      conversation_id: string;
      had_queued_messages: number;
    }>;

    if (!rows.length) return [];

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const clear = this.db.prepare(
        `
          UPDATE prime_figure_states
          SET silence_started_at_ms = NULL, silence_until_ms = NULL, updated_at = ?
          WHERE owner_user_id = ? AND agent_id = ? AND silence_until_ms IS NOT NULL AND silence_until_ms <= ?
        `,
      );
      for (const row of rows)
        clear.run(now, row.owner_user_id, row.agent_id, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return rows.map((row) => ({
      ownerUserId: row.owner_user_id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      hadQueuedMessages: row.had_queued_messages === 1,
    }));
  }
}

function buildInitialVariables(figure: CreatePrimeFigureRequest) {
  const variables: Record<string, PrimeFigureVariableValue> = {};

  for (const definition of figure.variableDefinitions ?? []) {
    if (definition.defaultValue !== undefined)
      variables[definition.key] = definition.defaultValue;
  }

  return variables;
}

function rowToState(row: PrimeFigureStateRow): PrimeFigureState {
  const recordedAtFallback = row.updated_at;
  return {
    variables: parseJson<Record<string, PrimeFigureVariableValue>>(
      row.variables_json,
      {},
    ),
    memories: parseJson<Array<PrimeFigureMemory & { createdAt?: number }>>(
      row.memories_json,
      [],
    ).map((memory) => ({
      id: memory.id,
      content: memory.content,
      eventAtMs: memory.eventAtMs ?? memory.createdAt ?? recordedAtFallback,
      recordedAtMs:
        memory.recordedAtMs ?? memory.createdAt ?? recordedAtFallback,
    })),
    mood: row.mood,
    moodObservedAtMs: row.mood_observed_at_ms || row.updated_at,
    relationshipStatus: row.relationship_status,
    ...(row.silence_started_at_ms
      ? { silenceStartedAtMs: row.silence_started_at_ms }
      : {}),
    ...(row.silence_until_ms ? { silenceUntilMs: row.silence_until_ms } : {}),
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
