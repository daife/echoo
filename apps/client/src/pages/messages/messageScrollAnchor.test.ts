import { describe, expect, it } from "vitest";
import {
  captureVisibleMessageAnchor,
  restoreVisibleMessageAnchor,
} from "./messageScrollAnchor";

function row(messageId: string, top: number, bottom: number) {
  return {
    dataset: { messageId },
    getBoundingClientRect: () => ({ top, bottom }),
  };
}

function scroller(rows: ReturnType<typeof row>[], scrollTop = 0) {
  return {
    scrollTop,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => rows,
  } as unknown as HTMLElement;
}

describe("message history scroll anchors", () => {
  it("captures the first row visible inside the scroll viewport", () => {
    const element = scroller([
      row("hidden", 20, 90),
      row("anchor", 80, 150),
      row("later", 150, 220),
    ]);

    expect(captureVisibleMessageAnchor(element)).toEqual({
      messageId: "anchor",
      offsetTop: -20,
    });
  });

  it("restores the same row to its previous viewport offset", () => {
    const element = scroller([row("anchor", 180, 240)], 300);

    restoreVisibleMessageAnchor(element, {
      messageId: "anchor",
      offsetTop: -20,
    });

    expect(element.scrollTop).toBe(400);
  });
});
