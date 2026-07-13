import { describe, expect, it } from "vitest";
import {
  activityAfterMessageCompleted,
  activityAfterMessageCreated,
} from "./conversationActivity";

describe("conversation agent activity recovery", () => {
  it("clears stale activity when a new end-user message starts a new boundary", () => {
    expect(
      activityAfterMessageCreated(true, { role: "user", status: "sent" }),
    ).toBe(false);
  });

  it("clears stale activity when a streamed reply fails", () => {
    expect(
      activityAfterMessageCompleted(true, {
        role: "assistant",
        status: "failed",
      }),
    ).toBe(false);
  });

  it("keeps activity while a successful multi-message reply is still running", () => {
    expect(
      activityAfterMessageCompleted(true, {
        role: "assistant",
        status: "delivered",
      }),
    ).toBe(true);
  });
});
