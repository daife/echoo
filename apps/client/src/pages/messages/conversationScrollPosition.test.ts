import { describe, expect, it } from "vitest";
import {
  isAwayFromLatestMessage,
  LATEST_MESSAGE_DISTANCE_THRESHOLD,
  shouldAdjustForConversationItemResize,
} from "./conversationScrollPosition";

describe("conversation scroll position", () => {
  it("keeps the latest-message button hidden near the bottom", () => {
    expect(
      isAwayFromLatestMessage({
        scrollHeight: 2_000,
        scrollTop: 1_300,
        clientHeight: 600,
      }),
    ).toBe(false);
  });

  it("shows the latest-message button after leaving the bottom threshold", () => {
    expect(
      isAwayFromLatestMessage({
        scrollHeight: 2_000,
        scrollTop: 1_300 - LATEST_MESSAGE_DISTANCE_THRESHOLD - 1,
        clientHeight: 600,
      }),
    ).toBe(true);
  });

  it("does not compensate item resizes while the user scrolls upward", () => {
    expect(
      shouldAdjustForConversationItemResize({
        itemEnd: 400,
        scrollTop: 800,
        direction: "up",
      }),
    ).toBe(false);
  });

  it("only compensates non-upward resizes fully above the viewport", () => {
    expect(
      shouldAdjustForConversationItemResize({
        itemEnd: 400,
        scrollTop: 800,
        direction: "down",
      }),
    ).toBe(true);
    expect(
      shouldAdjustForConversationItemResize({
        itemEnd: 900,
        scrollTop: 800,
        direction: null,
      }),
    ).toBe(false);
  });
});
