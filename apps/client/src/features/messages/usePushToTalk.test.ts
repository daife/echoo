import { describe, expect, it } from "vitest";
import { isPushToTalkCancelGesture } from "./usePushToTalk";

describe("push-to-talk gesture", () => {
  it("arms cancellation only after sliding upward by 72 pixels", () => {
    expect(isPushToTalkCancelGesture(500, 429)).toBe(false);
    expect(isPushToTalkCancelGesture(500, 428)).toBe(true);
    expect(isPushToTalkCancelGesture(500, 600)).toBe(false);
  });
});
