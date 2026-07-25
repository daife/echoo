import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinkedText, tokenizeLinkedText } from "./LinkedText";

describe("LinkedText", () => {
  it("recognizes HTTP links while preserving punctuation and newlines", () => {
    expect(
      tokenizeLinkedText(
        "动态 https://echoo.example/?post=post_1，\n卡片 https://echoo.example/?card=asset_1。",
      ),
    ).toEqual([
      { type: "text", value: "动态 " },
      { type: "url", value: "https://echoo.example/?post=post_1" },
      { type: "text", value: "，\n卡片 " },
      { type: "url", value: "https://echoo.example/?card=asset_1" },
      { type: "text", value: "。" },
    ]);
  });

  it("renders safe external anchors and leaves other schemes as text", () => {
    const html = renderToStaticMarkup(
      <LinkedText
        text={"<b>x</b> javascript:alert(1) https://outside.example/a"}
      />,
    );
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("javascript:alert(1)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://outside.example/a"');
  });
});
