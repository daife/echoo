import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeMessage, PrimeMessageContent } from "@echoo/shared";
import { calculateStableContextStart } from "../../../../infra/config/context-window-config.js";
import {
  hasOmittedPrimeConversation,
  mergePrimeTimeline,
} from "./prime-figure-runtime.service.js";

test("prime context retains 150-249 individual messages", () => {
  const window = { minimum: 150, maximum: 249 };
  const messages = Array.from({ length: 350 }, (_, index) =>
    message(index + 1, contentFor(index)),
  );

  assert.equal(
    messages.slice(calculateStableContextStart(249, window), 249).length,
    249,
  );

  const atFirstRollover = messages.slice(
    calculateStableContextStart(250, window),
    250,
  );
  assert.equal(atFirstRollover.length, 150);
  assert.equal(atFirstRollover[0]?.sequence, 101);

  const beforeSecondRollover = messages.slice(
    calculateStableContextStart(349, window),
    349,
  );
  assert.equal(beforeSecondRollover.length, 249);
  assert.equal(beforeSecondRollover[0]?.sequence, 101);

  const atSecondRollover = messages.slice(
    calculateStableContextStart(350, window),
  );
  assert.equal(atSecondRollover.length, 150);
  assert.equal(atSecondRollover[0]?.sequence, 201);
});

test("prime timeline keeps every unhandled message beyond the normal window", () => {
  const recent = Array.from({ length: 150 }, (_, index) =>
    message(index + 151, { type: "text", text: `recent ${index}` }),
  );
  const unhandled = Array.from({ length: 300 }, (_, index) =>
    message(index + 201, { type: "text", text: `unhandled ${index}` }),
  );

  const merged = mergePrimeTimeline(recent, unhandled);

  assert.equal(merged.length, 350);
  assert.equal(merged[0]?.sequence, 151);
  assert.equal(merged.at(-1)?.sequence, 500);
  assert.equal(new Set(merged.map((item) => item.id)).size, merged.length);
  assert.equal(hasOmittedPrimeConversation(500, merged), true);
});

test("prime recall availability uses the final merged timeline", () => {
  const recent = Array.from({ length: 2 }, (_, index) =>
    message(index + 4, { type: "text", text: `recent ${index}` }),
  );
  const restored = Array.from({ length: 3 }, (_, index) =>
    message(index + 1, { type: "text", text: `restored ${index}` }),
  );
  const complete = mergePrimeTimeline(recent, restored);

  assert.equal(complete.length, 5);
  assert.equal(hasOmittedPrimeConversation(5, complete), false);
  assert.equal(hasOmittedPrimeConversation(6, complete), true);
});

function contentFor(index: number): PrimeMessageContent {
  if (index % 3 === 0) return { type: "text", text: `text ${index}` };
  if (index % 3 === 1)
    return {
      type: "image",
      description: `image ${index}`,
      referenceResourceUrls: [],
    };
  return { type: "voice", transcript: `voice ${index}` };
}

function message(sequence: number, content: PrimeMessageContent): PrimeMessage {
  return {
    id: `message-${sequence}`,
    sequence,
    ownerUserId: "user-1",
    agentId: "agent-1",
    conversationId: "conversation-1",
    sender: sequence % 2 === 0 ? "prime_figure" : "end_user",
    messageType: content.type,
    content,
    occurredAtMs: sequence,
    occurredAtIso: new Date(sequence).toISOString(),
    createdAt: sequence,
    updatedAt: sequence,
  };
}
