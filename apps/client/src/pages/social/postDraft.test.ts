import { describe, expect, it } from "vitest";
import {
  insertMediaBlock,
  newTextBlock,
  removeMediaBlock,
  type DraftPostBlock,
} from "./postDraft";

function image(id = "image") {
  return {
    id,
    type: "image" as const,
    source: "existing" as const,
    resourceId: `res_${id}`,
    previewUrl: `/api/resources/res_${id}/file`,
  };
}

describe("post draft blocks", () => {
  it("splits text and inserts media at the cursor", () => {
    const text = newTextBlock("beforeafter");
    const result = insertMediaBlock(
      [text],
      { blockId: text.id, start: 6, end: 6 },
      image(),
    );
    expect(result.blocks.map(compact)).toEqual([
      "text:before",
      "image:image",
      "text:after",
    ]);
  });

  it("supports start, end, and consecutive insertions", () => {
    const text = newTextBlock("copy");
    const first = insertMediaBlock(
      [text],
      { blockId: text.id, start: 0, end: 0 },
      image("first"),
    );
    const second = insertMediaBlock(
      first.blocks,
      { blockId: first.focusBlockId!, start: 4, end: 4 },
      image("second"),
    );
    expect(second.blocks.map(compact)).toEqual([
      "text:",
      "image:first",
      "text:copy",
      "image:second",
      "text:",
    ]);
  });

  it("removes media and merges adjacent text", () => {
    const before = newTextBlock("before");
    const after = newTextBlock("after");
    const blocks: DraftPostBlock[] = [before, image(), after];
    expect(removeMediaBlock(blocks, "image").map(compact)).toEqual([
      "text:beforeafter",
    ]);
  });
});

function compact(block: DraftPostBlock) {
  return block.type === "text" ? `text:${block.text}` : `${block.type}:${block.id}`;
}
