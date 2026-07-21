import type {
  JsonObject,
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldRun,
  PrimeWorldRuntimeState,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../../../infra/database/mysql.js";
import { createId } from "../../../../shared/utils/id.js";

interface RunRow extends RowDataPacket {
  id: string;
  event_id: string;
  owner_user_id: string;
  conversation_id: string;
  definition_revision: number;
  status: PrimeWorldRun["status"];
  state_version_before: number | null;
  state_version_after: number | null;
  error_code: string | null;
  error_detail: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}
interface RunEventRow extends RunRow {
  event_type: PrimeWorldEventInput["type"];
  payload_json: unknown;
  definition_json: unknown;
}
interface StateRow extends RowDataPacket {
  state_json: unknown;
  version: number;
}
interface HistoryRow extends RowDataPacket {
  seq: number;
  role: string;
  content_json: unknown;
  token_estimate: number;
}

export class PrimeWorldRepository {
  async createEventAndRun(input: {
    ownerUserId: string;
    conversationId: string;
    definition: PrimeWorldDetail;
    event: PrimeWorldEventInput;
  }) {
    return withTransaction(async (connection) => {
      const existing = await queryOne<RunRow>(
        `SELECT runs.* FROM prime_world_events events JOIN prime_world_runs runs ON runs.event_id = events.id
         WHERE events.owner_user_id = ? AND events.client_event_id = ?`,
        [input.ownerUserId, input.event.clientEventId],
        connection,
      );
      if (existing) return { run: rowToRun(existing), created: false };
      const eventId = createId("pwe");
      const runId = createId("pwr");
      const now = Date.now();
      await execute(
        `INSERT INTO prime_world_events (id, owner_user_id, conversation_id, client_event_id, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          input.ownerUserId,
          input.conversationId,
          input.event.clientEventId,
          input.event.type,
          JSON.stringify({
            ...(input.event.payload ?? {}),
            ...(input.event.expectedViewRevision === undefined
              ? {}
              : { expectedViewRevision: input.event.expectedViewRevision }),
          }),
          now,
        ],
        connection,
      );
      await execute(
        `INSERT INTO prime_world_runs (id, event_id, owner_user_id, conversation_id, definition_revision, definition_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [
          runId,
          eventId,
          input.ownerUserId,
          input.conversationId,
          input.definition.definitionRevision,
          JSON.stringify(input.definition),
          now,
        ],
        connection,
      );
      return {
        run: {
          id: runId,
          eventId,
          conversationId: input.conversationId,
          definitionRevision: input.definition.definitionRevision,
          status: "queued" as const,
          createdAt: now,
        },
        created: true,
      };
    });
  }

  async getState(ownerUserId: string, conversationId: string) {
    const row = await queryOne<StateRow>(
      `SELECT state_json, version FROM agent_runtime_states WHERE owner_user_id = ? AND conversation_id = ?`,
      [ownerUserId, conversationId],
    );
    if (!row) return null;
    return { state: parseState(row.state_json), version: Number(row.version) };
  }

  async getRun(ownerUserId: string, runId: string) {
    const row = await queryOne<RunRow>(
      "SELECT * FROM prime_world_runs WHERE owner_user_id = ? AND id = ?",
      [ownerUserId, runId],
    );
    return row ? rowToRun(row) : null;
  }

  async getLatestRun(ownerUserId: string, conversationId: string) {
    const row = await queryOne<RunRow>(
      "SELECT * FROM prime_world_runs WHERE owner_user_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1",
      [ownerUserId, conversationId],
    );
    return row ? rowToRun(row) : null;
  }

  async getExecutionInput(
    ownerUserId: string,
    conversationId: string,
    runId: string,
  ) {
    const row = await queryOne<RunEventRow>(
      `SELECT runs.*, events.type AS event_type, events.payload_json
      FROM prime_world_runs runs JOIN prime_world_events events ON events.id = runs.event_id
      WHERE runs.owner_user_id = ? AND runs.conversation_id = ? AND runs.id = ?`,
      [ownerUserId, conversationId, runId],
    );
    if (!row) return null;
    const payload = parseObject(row.payload_json);
    const expectedViewRevision =
      typeof payload.expectedViewRevision === "number"
        ? payload.expectedViewRevision
        : undefined;
    delete payload.expectedViewRevision;
    return {
      run: rowToRun(row),
      definition: parseObject(
        row.definition_json,
      ) as unknown as PrimeWorldDetail,
      event: {
        clientEventId: row.event_id,
        type: row.event_type,
        payload,
        ...(expectedViewRevision === undefined ? {} : { expectedViewRevision }),
      } satisfies PrimeWorldEventInput,
    };
  }

  async startRun(ownerUserId: string, runId: string, stateVersion: number) {
    const result = await execute(
      `UPDATE prime_world_runs SET status = 'running', state_version_before = ?, started_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'queued'`,
      [stateVersion, Date.now(), runId, ownerUserId],
    );
    return result.affectedRows === 1;
  }

  async readHistory(
    ownerUserId: string,
    conversationId: string,
    input: {
      channel: string;
      roles: string[];
      maxEntries: number;
      maxTokens: number;
    },
  ) {
    const rows = await queryRows<HistoryRow>(
      `SELECT seq, role, content_json, token_estimate FROM prime_world_history_entries
      WHERE owner_user_id = ? AND conversation_id = ? AND channel = ? AND role IN (?)
      ORDER BY seq DESC LIMIT ?`,
      [
        ownerUserId,
        conversationId,
        input.channel,
        input.roles,
        Math.max(1, Math.min(input.maxEntries, 100)),
      ],
    );
    let tokens = 0;
    return rows
      .filter((row) => {
        if (tokens + row.token_estimate > input.maxTokens) return false;
        tokens += row.token_estimate;
        return true;
      })
      .reverse()
      .map((row) => ({
        role: row.role,
        content: parseObject(row.content_json),
        sequence: Number(row.seq),
      }));
  }

  async commit(input: {
    ownerUserId: string;
    conversationId: string;
    runId: string;
    beforeVersion: number;
    state: PrimeWorldRuntimeState;
    history: Array<{
      nodeId: string;
      channel: string;
      role: string;
      content: JsonObject;
    }>;
  }) {
    return withTransaction(async (connection) => {
      const now = Date.now();
      const active = await queryOne<
        { status: PrimeWorldRun["status"] } & RowDataPacket
      >(
        "SELECT status FROM prime_world_runs WHERE id = ? AND owner_user_id = ? FOR UPDATE",
        [input.runId, input.ownerUserId],
        connection,
      );
      if (active?.status !== "running") throw new Error("RUN_CANCELLED");
      const saved = await execute(
        `UPDATE agent_runtime_states SET state_json = ?, version = version + 1, updated_at = ?
        WHERE owner_user_id = ? AND conversation_id = ? AND version = ?`,
        [
          JSON.stringify({ ...input.state, updatedAt: now }),
          now,
          input.ownerUserId,
          input.conversationId,
          input.beforeVersion,
        ],
        connection,
      );
      if (!saved.affectedRows) throw new Error("STATE_CONFLICT");
      for (const entry of input.history)
        await execute(
          `INSERT IGNORE INTO prime_world_history_entries
        (id, owner_user_id, conversation_id, run_id, node_id, channel, role, content_json, token_estimate, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createId("pwh"),
            input.ownerUserId,
            input.conversationId,
            input.runId,
            entry.nodeId,
            entry.channel,
            entry.role,
            JSON.stringify(entry.content),
            Math.ceil(JSON.stringify(entry.content).length / 4),
            now,
          ],
          connection,
        );
      await execute(
        `UPDATE prime_world_runs SET status = 'completed', state_version_after = ?, finished_at = ? WHERE id = ?`,
        [input.beforeVersion + 1, now, input.runId],
        connection,
      );
      await markEventProcessed(connection, input.runId, now);
      return input.beforeVersion + 1;
    });
  }

  async fail(ownerUserId: string, runId: string, code: string, detail: string) {
    const now = Date.now();
    await execute(
      `UPDATE prime_world_runs SET status = 'failed', error_code = ?, error_detail = ?, finished_at = ? WHERE owner_user_id = ? AND id = ? AND status IN ('queued', 'running')`,
      [code, detail.slice(0, 2000), now, ownerUserId, runId],
    );
    await execute(
      "UPDATE prime_world_events events JOIN prime_world_runs runs ON runs.event_id = events.id SET events.processed_at = ? WHERE runs.id = ?",
      [now, runId],
    );
  }

  async cancel(ownerUserId: string, conversationId: string, runId: string) {
    const now = Date.now();
    const result = await execute(
      `UPDATE prime_world_runs SET status = 'cancelled', error_code = 'CANCELLED', finished_at = ?
      WHERE owner_user_id = ? AND conversation_id = ? AND id = ? AND status IN ('queued', 'running')`,
      [now, ownerUserId, conversationId, runId],
    );
    if (result.affectedRows)
      await execute(
        "UPDATE prime_world_events events JOIN prime_world_runs runs ON runs.event_id = events.id SET events.processed_at = ? WHERE runs.id = ?",
        [now, runId],
      );
    return result.affectedRows === 1;
  }

  async cancelOtherActiveRuns(
    ownerUserId: string,
    conversationId: string,
    exceptRunId: string,
  ) {
    const rows = await queryRows<RunRow>(
      `SELECT * FROM prime_world_runs WHERE owner_user_id = ? AND conversation_id = ? AND id != ? AND status IN ('queued', 'running')`,
      [ownerUserId, conversationId, exceptRunId],
    );
    await Promise.all(
      rows.map((row) => this.cancel(ownerUserId, conversationId, row.id)),
    );
    return rows.map((row) => row.id);
  }

  async listQueuedRuns(olderThan: number, limit = 100) {
    const rows = await queryRows<RunRow>(
      "SELECT * FROM prime_world_runs WHERE status = 'queued' AND created_at <= ? ORDER BY created_at ASC LIMIT ?",
      [olderThan, limit],
    );
    return rows.map((row) => ({
      ownerUserId: row.owner_user_id,
      conversationId: row.conversation_id,
      runId: row.id,
    }));
  }
}

async function markEventProcessed(
  connection: Parameters<typeof queryOne>[2],
  runId: string,
  now: number,
) {
  await execute(
    "UPDATE prime_world_events events JOIN prime_world_runs runs ON runs.event_id = events.id SET events.processed_at = ? WHERE runs.id = ?",
    [now, runId],
    connection,
  );
}
function parseState(value: unknown): PrimeWorldRuntimeState {
  return parseObject(value) as unknown as PrimeWorldRuntimeState;
}
function parseObject(value: unknown): JsonObject {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return structuredClone(parsed) as JsonObject;
  } catch {
    throw new Error("WORLD_DATA_INVALID");
  }
}
function rowToRun(row: RunRow): PrimeWorldRun {
  return {
    id: row.id,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    definitionRevision: row.definition_revision,
    status: row.status,
    ...(row.state_version_before !== null
      ? { stateVersionBefore: Number(row.state_version_before) }
      : {}),
    ...(row.state_version_after !== null
      ? { stateVersionAfter: Number(row.state_version_after) }
      : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    ...(row.started_at ? { startedAt: Number(row.started_at) } : {}),
    ...(row.finished_at ? { finishedAt: Number(row.finished_at) } : {}),
    createdAt: Number(row.created_at),
  };
}
