import { describe, expect, it } from "vitest";
import { resolveTextSubmission } from "./messageComposerSubmission";

describe("message composer text submission", () => {
  it("uses the input's live value when React draft state is behind", () => {
    expect(resolveTextSubmission("最终输入", "最终输")).toBe("最终输入");
  });

  it("falls back to the draft when no live input is available", () => {
    expect(resolveTextSubmission(undefined, "  hello  ")).toBe("hello");
  });

  it("rejects blank submissions", () => {
    expect(resolveTextSubmission(" \n ", "stale draft")).toBeNull();
  });
});
