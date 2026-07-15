import { describe, expect, it } from "vitest";
import { fitMessageMedia } from "./mediaLayout";

describe("message media layout", () => {
  it("fits portrait images without changing their aspect ratio", () => {
    expect(fitMessageMedia({ width: 900, height: 1_600 }, "image")).toEqual({
      width: 270,
      height: 480,
    });
  });

  it("fits stickers within their stable maximum box", () => {
    expect(fitMessageMedia({ width: 800, height: 400 }, "sticker")).toEqual({
      width: 176,
      height: 88,
    });
  });

  it("uses a stable fallback ratio for invalid dimensions", () => {
    expect(fitMessageMedia(undefined, "image")).toEqual({
      width: 320,
      height: 240,
    });
    expect(fitMessageMedia({ width: 0, height: 100 }, "sticker")).toEqual({
      width: 176,
      height: 176,
    });
  });
});
