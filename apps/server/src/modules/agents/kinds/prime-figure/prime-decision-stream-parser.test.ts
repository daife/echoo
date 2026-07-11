import assert from "node:assert/strict";
import test from "node:test";
import {
  PrimeDecisionStreamParser,
  type PrimeDecisionStreamFieldDelta,
} from "./prime-decision-stream-parser.js";

test("Prime decision stream parser emits ordered message fields across arbitrary chunks", () => {
  const events: PrimeDecisionStreamFieldDelta[] = [];
  const parser = new PrimeDecisionStreamParser((event) => events.push(event));
  const json = JSON.stringify({
    rationale: "voice should stream",
    figureMood: "excited",
    actions: [
      {
        type: "send_message",
        message: {
          type: "voice",
          transcript: "他真的爱武术[emphasis]吗？[chuckling] 我差点挂了。",
        },
      },
      {
        type: "send_message",
        message: { type: "text", text: "下一条\n消息" },
      },
    ],
  });

  for (let index = 0; index < json.length; index += (index % 7) + 1)
    parser.push(json.slice(index, index + (index % 7) + 1));

  const completeFields = events.filter((event) => event.complete);
  assert.deepEqual(
    completeFields.map(({ actionIndex, field }) => [actionIndex, field]),
    [
      [0, "type"],
      [0, "transcript"],
      [1, "type"],
      [1, "text"],
    ],
  );
  assert.equal(
    joinField(events, 0, "transcript"),
    "他真的爱武术[emphasis]吗？[chuckling] 我差点挂了。",
  );
  assert.equal(joinField(events, 1, "text"), "下一条\n消息");
  assert.equal(
    events.some((event) => event.field === "description"),
    false,
  );
});

test("Prime decision stream parser decodes escaped unicode incrementally", () => {
  const events: PrimeDecisionStreamFieldDelta[] = [];
  const parser = new PrimeDecisionStreamParser((event) => events.push(event));
  for (const chunk of [
    '{"actions":[{"message":{"type":"text","text":"A\\u',
    "4f",
    '60\\nB"}}]}',
  ])
    parser.push(chunk);
  assert.equal(joinField(events, 0, "text"), "A你\nB");
});

function joinField(
  events: PrimeDecisionStreamFieldDelta[],
  actionIndex: number,
  field: PrimeDecisionStreamFieldDelta["field"],
) {
  return events
    .filter(
      (event) => event.actionIndex === actionIndex && event.field === field,
    )
    .map((event) => event.delta)
    .join("");
}
