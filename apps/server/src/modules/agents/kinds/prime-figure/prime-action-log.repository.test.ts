import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunFailureRepository } from "../../agent-run-failure.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";

test("persists failed Prime Figure actions in the run failure audit repository", async () => {
  const records: unknown[] = [];
  const failures = {
    record: async (input: unknown) => {
      records.push(input);
      return null;
    },
  } as unknown as AgentRunFailureRepository;
  const repository = new PrimeActionLogRepository(failures);

  await repository.save({
    ownerUserId: "user_1",
    agentId: "agent_1",
    conversationId: "conversation_1",
    action: { type: "image_generation", actionIndex: 2 },
    rationale: "test rationale",
    status: "failed",
    errorMessage: "provider unavailable",
    rawOutput: "{ invalid: true }",
    diagnostics: { providerId: "openrouter", model: "example/model" },
    now: 123,
  });

  assert.deepEqual(records, [
    {
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      kind: "prime-figure",
      phase: "image_generation",
      errorMessage: "provider unavailable",
      rawOutput: "{ invalid: true }",
      diagnostics: {
        agentId: "agent_1",
        action: { type: "image_generation", actionIndex: 2 },
        rationale: "test rationale",
        providerId: "openrouter",
        model: "example/model",
      },
      now: 123,
    },
  ]);
});

test("does not create failure audit noise for applied actions", async () => {
  let calls = 0;
  const failures = {
    record: async () => {
      calls += 1;
      return null;
    },
  } as unknown as AgentRunFailureRepository;
  const repository = new PrimeActionLogRepository(failures);

  await repository.save({
    ownerUserId: "user_1",
    agentId: "agent_1",
    conversationId: "conversation_1",
    action: { type: "send_message" },
    status: "applied",
  });

  assert.equal(calls, 0);
});
