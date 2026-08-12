import assert from "node:assert/strict";
import test from "node:test";
import type { RowDataPacket } from "mysql2";
import {
  rowToFailure,
  shouldAuditAgentRunFailure,
} from "./agent-run-failure.repository.js";
import { InsufficientPlatformBalanceError } from "../billing/billing-error.js";

test("maps persisted run failure diagnostics and retry payloads", () => {
  const failure = rowToFailure({
    id: "runfail_1",
    owner_user_id: "user_1",
    conversation_id: "conversation_1",
    kind: "slice-figure",
    run_id: null,
    phase: "queue_exhausted",
    error_message: "provider unavailable",
    raw_output: "{ invalid: true }",
    raw_output_truncated: 0,
    diagnostics_json: JSON.stringify({ queueEntryId: "1-0" }),
    retry_payload_json: { kind: "slice-figure", attempts: 0 },
    attempts: 3,
    review_status: "open",
    review_note: null,
    reviewed_at: null,
    created_at: 100,
    updated_at: 101,
  } as RowDataPacket & Parameters<typeof rowToFailure>[0]);

  assert.deepEqual(failure, {
    id: "runfail_1",
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    kind: "slice-figure",
    phase: "queue_exhausted",
    errorMessage: "provider unavailable",
    rawOutput: "{ invalid: true }",
    rawOutputTruncated: false,
    diagnostics: { queueEntryId: "1-0" },
    retryPayload: { kind: "slice-figure", attempts: 0 },
    attempts: 3,
    reviewStatus: "open",
    createdAt: 100,
    updatedAt: 101,
  });
});

test("excludes user balance failures from platform failure review", () => {
  assert.equal(
    shouldAuditAgentRunFailure(
      new InsufficientPlatformBalanceError(
        "平台余额不足，请充值后再使用平台提供的 AI 服务。",
      ),
    ),
    false,
  );
  assert.equal(
    shouldAuditAgentRunFailure(new Error("provider unavailable")),
    true,
  );
});
