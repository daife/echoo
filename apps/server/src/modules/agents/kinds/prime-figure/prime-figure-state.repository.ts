import type { CreatePrimeFigureRequest, PrimeFigureState, PrimeFigureVariableValue } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, queryRows, withTransaction } from "../../../../infra/database/mysql.js";
import { AgentRepository } from "../../agent.repository.js";

export interface DuePrimeFigureSilence {
  ownerUserId: string; agentId: string; conversationId: string; hadQueuedMessages: boolean;
}
interface StateRow extends RowDataPacket { runtime_state: unknown; }
interface DueRow extends RowDataPacket {
  owner_user_id: string; agent_id: string; conversation_id: string;
  silence_started_at: number; had_queued_messages: number;
}

export class PrimeFigureStateRepository {
  constructor(private readonly agents = new AgentRepository()) {}
  async createInitial(input: { ownerUserId: string; agentId: string; figure: CreatePrimeFigureRequest; now: number }) {
    const variables: Record<string, PrimeFigureVariableValue> = {};
    for (const definition of input.figure.variableDefinitions ?? [])
      if (definition.defaultValue !== undefined) variables[definition.key] = definition.defaultValue;
    await this.save(input.ownerUserId, input.agentId, {
      variables, memories: [], mood: input.figure.initialMood ?? "",
      moodObservedAtMs: input.now,
      relationshipStatus: input.figure.initialRelationshipStatus ?? "", updatedAt: input.now,
    });
  }
  async findByAgent(ownerUserId: string, agentId: string) {
    const row = await queryOne<StateRow>(
      "SELECT runtime_state FROM agents WHERE owner_user_id = ? AND id = ?", [ownerUserId, agentId]);
    return row ? parseJson<PrimeFigureState>(row.runtime_state, null as never) : null;
  }
  async save(ownerUserId: string, agentId: string, state: PrimeFigureState) {
    await this.agents.saveRuntimeState(ownerUserId, agentId, state, state.silenceUntilMs ?? null);
  }
  async reconcileVariables(ownerUserId: string, agentId: string,
    figure: Pick<CreatePrimeFigureRequest, "variableDefinitions">) {
    const state = await this.findByAgent(ownerUserId, agentId);
    if (!state) return;
    const variables: Record<string, PrimeFigureVariableValue> = {};
    for (const definition of figure.variableDefinitions ?? []) {
      if (state.variables[definition.key] !== undefined) variables[definition.key] = state.variables[definition.key]!;
      else if (definition.defaultValue !== undefined) variables[definition.key] = definition.defaultValue;
    }
    await this.save(ownerUserId, agentId, { ...state, variables, updatedAt: Date.now() });
  }
  async claimDueSilences(now: number, limit = 100) {
    return withTransaction(async (connection) => {
      const rows = await queryRows<DueRow>(
        `SELECT agents.owner_user_id, agents.id AS agent_id, conversations.id AS conversation_id,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(agents.runtime_state, '$.silenceStartedAtMs')) AS UNSIGNED) AS silence_started_at,
          EXISTS(SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id
            AND messages.role = 'user' AND messages.created_at > COALESCE(
              CAST(JSON_UNQUOTE(JSON_EXTRACT(agents.runtime_state, '$.silenceStartedAtMs')) AS UNSIGNED), 0)) AS had_queued_messages
         FROM agents JOIN conversations ON conversations.agent_id = agents.id
         WHERE agents.type = 'prime-figure' AND agents.next_run_at IS NOT NULL AND agents.next_run_at <= ?
         ORDER BY agents.next_run_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
        [now, Math.min(Math.max(Math.trunc(limit), 1), 500)], connection);
      for (const row of rows) {
        await execute(
          `UPDATE agents SET next_run_at = NULL,
           runtime_state = JSON_REMOVE(runtime_state, '$.silenceStartedAtMs', '$.silenceUntilMs'), updated_at = ?
           WHERE id = ?`, [now, row.agent_id], connection);
      }
      return rows.map((row) => ({ ownerUserId: row.owner_user_id, agentId: row.agent_id,
        conversationId: row.conversation_id, hadQueuedMessages: Boolean(row.had_queued_messages) }));
    });
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
