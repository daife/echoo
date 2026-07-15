import assert from "node:assert/strict";
import test from "node:test";
import { advanceHandledSequenceAfterSuccessfulRun } from "./prime-run-commit.js";

test("advances the handled end-user sequence only after a successful run", async () => {
  let advances = 0;
  const result = await advanceHandledSequenceAfterSuccessfulRun(
    Promise.resolve("decision"),
    async () => {
      advances += 1;
    },
  );

  assert.equal(result, "decision");
  assert.equal(advances, 1);
});

test("does not advance the handled end-user sequence when the run fails", async () => {
  let advances = 0;
  const failure = new Error(
    "openrouter chat completion failed: This response_format type is unavailable now",
  );

  await assert.rejects(
    advanceHandledSequenceAfterSuccessfulRun(
      Promise.reject(failure),
      async () => {
        advances += 1;
      },
    ),
    failure,
  );
  assert.equal(advances, 0);
});
