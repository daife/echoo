import { describe, expect, it } from "vitest";
import { shouldSubmitTextInput } from "./messageComposerSubmission";

describe("message composer keyboard submission", () => {
  it("submits an ordinary Enter key", () => {
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: false, keyCode: 13 }),
    ).toBe(true);
  });

  it("does not submit IME composition confirmation", () => {
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: true, keyCode: 13 }),
    ).toBe(false);
    expect(
      shouldSubmitTextInput({ key: "Enter", isComposing: false, keyCode: 229 }),
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(
      shouldSubmitTextInput({ key: "Process", isComposing: false, keyCode: 0 }),
    ).toBe(false);
  });
});
