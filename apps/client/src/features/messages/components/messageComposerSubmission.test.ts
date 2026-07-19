import { describe, expect, it } from "vitest";
import {
  resolveTextSubmission,
  shouldSuppressComposerActionClick,
  shouldSubmitTextBeforeInput,
  shouldSubmitTextInput,
} from "./messageComposerSubmission";

describe("message composer keyboard submission", () => {
  it("submits an ordinary Enter key", () => {
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: false, keyCode: 13 }),
    ).toBe(true);
  });

  it("submits Android Enter even when its legacy key code is 229", () => {
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: false, keyCode: 229 }),
    ).toBe(true);
  });

  it("does not submit while the IME is composing", () => {
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: true, keyCode: 229 }),
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(
      shouldSubmitTextInput({
        key: "Process",
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });
});

describe("message composer action click suppression", () => {
  it("suppresses the click synthesized immediately after pointer submission", () => {
    expect(shouldSuppressComposerActionClick(1_250, 1_000)).toBe(true);
  });

  it("allows a later intentional action click", () => {
    expect(shouldSuppressComposerActionClick(1_250, 1_250)).toBe(false);
  });
});

describe("message composer beforeinput submission", () => {
  it.each(["insertLineBreak", "insertParagraph"])(
    "submits %s from a mobile keyboard",
    (inputType) => {
      expect(
        shouldSubmitTextBeforeInput({ inputType, isComposing: false }),
      ).toBe(true);
    },
  );

  it("does not submit a line break while the IME is composing", () => {
    expect(
      shouldSubmitTextBeforeInput({
        inputType: "insertLineBreak",
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("ignores ordinary text input", () => {
    expect(
      shouldSubmitTextBeforeInput({
        inputType: "insertText",
        isComposing: false,
      }),
    ).toBe(false);
  });
});

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
