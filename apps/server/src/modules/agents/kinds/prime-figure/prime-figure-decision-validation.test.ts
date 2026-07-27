import assert from "node:assert/strict";
import test from "node:test";
import { primeFigureDecisionSchema } from "@echoo/shared";

test("accepts null stateUpdates as no state changes", () => {
  const decision = primeFigureDecisionSchema.parse({
    rationale: "保持当前状态即可。",
    figureMood: "平静",
    variables: {},
    stateUpdates: null,
  });

  assert.deepEqual(decision.stateUpdates, {});
});
