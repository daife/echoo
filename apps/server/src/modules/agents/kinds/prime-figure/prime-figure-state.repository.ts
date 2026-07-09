import type { CreatePrimeFigureRequest, PrimeFigureMemory, PrimeFigureState, PrimeFigureVariableValue } from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

interface PrimeFigureStateRow {
  agent_id: string;
  owner_user_id: string;
  current_schedule_json: string;
  itinerary_json: string;
  variables_json: string;
  memories_json: string;
  mood: string;
  relationship_status: string;
  next_wakeup_at_ms: number | null;
  created_at: number;
  updated_at: number;
}

export class PrimeFigureStateRepository {
  private readonly db = getDatabase();

  createInitial(input: { ownerUserId: string; agentId: string; figure: CreatePrimeFigureRequest; now: number }) {
    const variables = buildInitialVariables(input.figure);

    this.db
      .prepare(
        `
          INSERT INTO prime_figure_states (
            agent_id,
            owner_user_id,
            current_schedule_json,
            itinerary_json,
            variables_json,
            memories_json,
            mood,
            relationship_status,
            next_wakeup_at_ms,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.agentId,
        input.ownerUserId,
        JSON.stringify(input.figure.schedule ?? {}),
        JSON.stringify(input.figure.itinerary ?? {}),
        JSON.stringify(variables),
        JSON.stringify([]),
        input.figure.initialMood ?? "",
        input.figure.initialRelationshipStatus ?? "",
        null,
        input.now,
        input.now
      );
  }

  findByAgent(ownerUserId: string, agentId: string): PrimeFigureState | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM prime_figure_states
          WHERE owner_user_id = ? AND agent_id = ?
        `
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
            current_schedule_json = ?,
            itinerary_json = ?,
            variables_json = ?,
            memories_json = ?,
            mood = ?,
            relationship_status = ?,
            next_wakeup_at_ms = ?,
            updated_at = ?
          WHERE owner_user_id = ? AND agent_id = ?
        `
      )
      .run(
        JSON.stringify(state.currentSchedule),
        JSON.stringify(state.itinerary),
        JSON.stringify(state.variables),
        JSON.stringify(state.memories),
        state.mood,
        state.relationshipStatus,
        state.nextWakeupAtMs ?? null,
        state.updatedAt,
        ownerUserId,
        agentId
      );
  }
}

function buildInitialVariables(figure: CreatePrimeFigureRequest) {
  const variables: Record<string, PrimeFigureVariableValue> = {};

  for (const definition of figure.variableDefinitions ?? []) {
    if (definition.defaultValue !== undefined) variables[definition.key] = definition.defaultValue;
  }

  return {
    ...variables,
    ...(figure.initialVariables ?? {})
  };
}

function rowToState(row: PrimeFigureStateRow): PrimeFigureState {
  return {
    currentSchedule: parseJson<Record<string, unknown>>(row.current_schedule_json, {}),
    itinerary: parseJson<Record<string, unknown>>(row.itinerary_json, {}),
    variables: parseJson<Record<string, PrimeFigureVariableValue>>(row.variables_json, {}),
    memories: parseJson<PrimeFigureMemory[]>(row.memories_json, []),
    mood: row.mood,
    relationshipStatus: row.relationship_status,
    ...(row.next_wakeup_at_ms ? { nextWakeupAtMs: row.next_wakeup_at_ms } : {}),
    updatedAt: row.updated_at
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
