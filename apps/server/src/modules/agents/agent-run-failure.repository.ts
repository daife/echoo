import type { RowDataPacket } from "mysql2";
import { createId } from "../../shared/utils/id.js";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";

export type AgentRunFailureKind =
  "slice-figure" | "prime-figure" | "prime-world";
export type AgentRunFailureReviewStatus =
  "open" | "reviewed" | "retrying" | "retried" | "resolved";

export interface AgentRunFailure {
  id: string;
  ownerUserId: string;
  conversationId: string;
  kind: AgentRunFailureKind;
  runId?: string;
  phase: string;
  errorMessage: string;
  rawOutput?: string;
  rawOutputTruncated: boolean;
  diagnostics?: unknown;
  retryPayload?: Record<string, unknown>;
  attempts: number;
  reviewStatus: AgentRunFailureReviewStatus;
  reviewNote?: string;
  reviewedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface FailureRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  conversation_id: string;
  kind: AgentRunFailureKind;
  run_id: string | null;
  phase: string;
  error_message: string;
  raw_output: string | null;
  raw_output_truncated: number;
  diagnostics_json: unknown | null;
  retry_payload_json: unknown | null;
  attempts: number;
  review_status: AgentRunFailureReviewStatus;
  review_note: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class AgentRunFailureRepository {
  async record(input: {
    ownerUserId: string;
    conversationId: string;
    kind: AgentRunFailureKind;
    runId?: string;
    phase: string;
    errorMessage: string;
    rawOutput?: string;
    diagnostics?: unknown;
    retryPayload?: Record<string, unknown>;
    attempts?: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const id = createId("runfail");
    const rawOutput = truncateUtf8(input.rawOutput, 256 * 1_024);
    await execute(
      `INSERT INTO agent_run_failures
       (id, owner_user_id, conversation_id, kind, run_id, phase,
        error_message, raw_output, raw_output_truncated, diagnostics_json,
        retry_payload_json, attempts,
        review_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [
        id,
        input.ownerUserId,
        input.conversationId,
        input.kind,
        input.runId ?? null,
        input.phase.slice(0, 80),
        input.errorMessage.slice(0, 2_000),
        rawOutput?.value ?? null,
        rawOutput?.truncated ?? false,
        serializeJson(input.diagnostics),
        serializeJson(input.retryPayload),
        Math.max(0, Math.trunc(input.attempts ?? 0)),
        now,
        now,
      ],
    );
    return this.findById(id);
  }

  async list(
    input: {
      status?: AgentRunFailureReviewStatus;
      kind?: AgentRunFailureKind;
      limit?: number;
      before?: number;
    } = {},
  ) {
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 50)));
    const rows = await queryRows<FailureRow>(
      `SELECT * FROM agent_run_failures
       WHERE (? IS NULL OR review_status = ?)
         AND (? IS NULL OR kind = ?)
         AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [
        input.status ?? null,
        input.status ?? null,
        input.kind ?? null,
        input.kind ?? null,
        input.before ?? null,
        input.before ?? null,
        limit,
      ],
    );
    return rows.map(rowToFailure);
  }

  async findById(id: string) {
    const row = await queryOne<FailureRow>(
      "SELECT * FROM agent_run_failures WHERE id = ?",
      [id],
    );
    return row ? rowToFailure(row) : null;
  }

  async review(input: {
    id: string;
    status: "open" | "reviewed" | "resolved";
    note?: string;
  }) {
    const now = Date.now();
    const result = await execute(
      `UPDATE agent_run_failures
       SET review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.status,
        input.note?.trim().slice(0, 1_000) || null,
        input.status === "open" ? null : now,
        now,
        input.id,
      ],
    );
    return result.affectedRows ? this.findById(input.id) : null;
  }

  async beginRetry(id: string) {
    return withTransaction(async (connection) => {
      const row = await queryOne<FailureRow>(
        "SELECT * FROM agent_run_failures WHERE id = ? FOR UPDATE",
        [id],
        connection,
      );
      if (!row || !row.retry_payload_json) return null;
      if (row.review_status === "retrying" || row.review_status === "retried")
        return null;
      const now = Date.now();
      await execute(
        `UPDATE agent_run_failures
         SET review_status = 'retrying', reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, id],
        connection,
      );
      return rowToFailure({ ...row, review_status: "retrying" });
    });
  }

  async finishRetry(id: string, succeeded: boolean) {
    const now = Date.now();
    await execute(
      `UPDATE agent_run_failures
       SET review_status = ?, updated_at = ? WHERE id = ? AND review_status = 'retrying'`,
      [succeeded ? "retried" : "open", now, id],
    );
    return this.findById(id);
  }
}

function serializeJson(value: unknown) {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= 64 * 1_024) return serialized;
  return JSON.stringify({
    truncated: true,
    preview: serialized.slice(0, 60_000),
  });
}

export function rowToFailure(row: FailureRow): AgentRunFailure {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    conversationId: row.conversation_id,
    kind: row.kind,
    ...(row.run_id ? { runId: row.run_id } : {}),
    phase: row.phase,
    errorMessage: row.error_message,
    ...(row.raw_output !== null ? { rawOutput: row.raw_output } : {}),
    rawOutputTruncated: Boolean(row.raw_output_truncated),
    ...(row.diagnostics_json !== null
      ? { diagnostics: parseJson(row.diagnostics_json) }
      : {}),
    ...(row.retry_payload_json !== null
      ? {
          retryPayload: parseJson(row.retry_payload_json) as Record<
            string,
            unknown
          >,
        }
      : {}),
    attempts: row.attempts,
    reviewStatus: row.review_status,
    ...(row.review_note ? { reviewNote: row.review_note } : {}),
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function truncateUtf8(value: string | undefined, maxBytes: number) {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") <= maxBytes)
    return { value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes)
      low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1]!)) low -= 1;
  return { value: value.slice(0, low), truncated: true };
}
