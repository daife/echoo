import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeMessage } from "@echoo/shared";
import { requiresDirectMediaReply } from "./prime-media-trigger.js";

test("requires a visible reply for a newly received media-only turn", () => {
  assert.equal(
    requiresDirectMediaReply(
      [message(10, "image"), message(11, "voice")],
      9,
    ),
    true,
  );
});

test("does not constrain text, already handled media, or assistant media", () => {
  assert.equal(requiresDirectMediaReply([message(10, "text")], 9), false);
  assert.equal(requiresDirectMediaReply([message(10, "image")], 10), false);
  assert.equal(
    requiresDirectMediaReply(
      [{ ...message(10, "image"), sender: "prime_figure" }],
      9,
    ),
    false,
  );
});

function message(
  sequence: number,
  type: "text" | "image" | "voice",
): PrimeMessage {
  return {
    id: `msg_${sequence}`,
    sequence,
    ownerUserId: "user_1",
    agentId: "agent_1",
    conversationId: "conversation_1",
    sender: "end_user",
    messageType: type,
    content:
      type === "text"
        ? { type, text: "hello" }
        : type === "image"
          ? { type, referenceResourceUrls: [], resourceId: "resource_1" }
          : { type, resourceId: "resource_1" },
    occurredAtMs: sequence,
    occurredAtIso: new Date(sequence).toISOString(),
    createdAt: sequence,
    updatedAt: sequence,
  };
}
