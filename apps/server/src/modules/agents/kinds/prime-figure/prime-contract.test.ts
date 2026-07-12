import assert from "node:assert/strict";
import test from "node:test";
import {
  primeFigureDecisionSchema,
  primeFigureScheduleSchema,
} from "@echoo/shared";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";

test("prime decision parser preserves streamed visible message fields", () => {
  const events: Array<{
    actionIndex: number;
    field: string;
    delta: string;
    complete: boolean;
  }> = [];
  const parser = new PrimeDecisionStreamParser((event) => events.push(event));
  const json = JSON.stringify({
    rationale: "回应",
    figureMood: "平静",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "晚上好" } },
    ],
  });
  for (const chunk of json.match(/.{1,7}/g) ?? []) parser.push(chunk);
  assert.equal(
    events
      .filter((event) => event.field === "text")
      .map((event) => event.delta)
      .join(""),
    "晚上好",
  );
  assert.equal(
    events.some((event) => event.field === "text" && event.complete),
    true,
  );
});

test("prime schedule and decision contracts use fixed server timezone", () => {
  assert.deepEqual(primeFigureScheduleSchema.parse({ segments: [] }), {
    segments: [],
  });
  const decision = primeFigureDecisionSchema.parse({
    rationale: "等待",
    figureMood: "专注",
    variables: {},
    stateUpdates: { schedule: { segments: [] } },
    actions: [{ type: "silence" }],
  });
  assert.deepEqual(decision.stateUpdates.schedule, { segments: [] });
  assert.equal("timezone" in (decision.stateUpdates.schedule ?? {}), false);
});

test("prime decision distinguishes one-turn silence from message muting", () => {
  const base = { rationale: "等待", figureMood: "平静", variables: {} };
  assert.deepEqual(
    primeFigureDecisionSchema.parse({ ...base, actions: [{ type: "silence" }] })
      .actions,
    [{ type: "silence" }],
  );
  assert.deepEqual(
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "mute", revisitAfterMinutes: 5 }],
    }).actions,
    [{ type: "mute", revisitAfterMinutes: 5 }],
  );
  assert.throws(() =>
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "silence", revisitAfterMinutes: 5 }],
    }),
  );
});
