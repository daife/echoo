import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeWorldRepository } from "./prime-world.repository.js";
import { PrimeWorldRetentionScheduler } from "./prime-world-retention.scheduler.js";

test("runs retention with configured age thresholds", async () => {
  const calls: Array<{ compactBefore: number; deleteBefore: number }> = [];
  const worlds = {
    async compactAndPruneRuns(input: {
      compactBefore: number;
      deleteBefore: number;
    }) {
      calls.push(input);
      return { compacted: 2, deleted: 1 };
    },
  } as unknown as PrimeWorldRepository;
  const scheduler = new PrimeWorldRetentionScheduler(worlds);
  const now = Date.now();

  const result = await scheduler.runOnce(now);

  assert.deepEqual(result, { compacted: 2, deleted: 1 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.compactBefore < now);
  assert.ok(calls[0]!.deleteBefore < calls[0]!.compactBefore);
});

test("does not overlap retention runs", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const worlds = {
    async compactAndPruneRuns() {
      calls += 1;
      await pending;
      return { compacted: 0, deleted: 0 };
    },
  } as unknown as PrimeWorldRepository;
  const scheduler = new PrimeWorldRetentionScheduler(worlds);

  const first = scheduler.runOnce();
  const second = await scheduler.runOnce();
  release();
  await first;

  assert.deepEqual(second, { compacted: 0, deleted: 0 });
  assert.equal(calls, 1);
});
