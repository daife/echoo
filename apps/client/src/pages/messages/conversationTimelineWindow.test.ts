import type { LocalMessage } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  mergeNewerTimelineWindow,
  mergeOlderTimelineWindow,
} from "./conversationTimelineWindow";

function message(sequence: number): LocalMessage {
  return {
    id: `message-${sequence}`,
    conversationId: "conversation",
    sequence,
    role: sequence % 2 ? "user" : "assistant",
    contentType: "text",
    content: { text: String(sequence) },
    status: "delivered",
    createdAt: sequence,
    updatedAt: sequence,
    syncStatus: "synced",
  };
}

describe("conversation timeline windows", () => {
  it("keeps every newer message after merging an older page within the limit", () => {
    const result = mergeOlderTimelineWindow({
      current: [message(3), message(4)],
      incoming: [message(1), message(2)],
      maximumMessages: 5,
      hasNewer: false,
    });

    expect(result.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.overflowed).toBe(false);
    expect(result.oppositeEdgeMissing).toBe(false);
  });

  it("reports overflow only when an older merge actually trims the newer edge", () => {
    const result = mergeOlderTimelineWindow({
      current: [message(3), message(4)],
      incoming: [message(1), message(2)],
      maximumMessages: 3,
      hasNewer: false,
    });

    expect(result.messages.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(result.overflowed).toBe(true);
    expect(result.oppositeEdgeMissing).toBe(true);
  });

  it("trims the older edge symmetrically when merging a newer page", () => {
    const result = mergeNewerTimelineWindow({
      current: [message(1), message(2)],
      incoming: [message(3), message(4)],
      maximumMessages: 3,
      hasOlder: false,
    });

    expect(result.messages.map((item) => item.sequence)).toEqual([2, 3, 4]);
    expect(result.overflowed).toBe(true);
    expect(result.oppositeEdgeMissing).toBe(true);
  });
});
