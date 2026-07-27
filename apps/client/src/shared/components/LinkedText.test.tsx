import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MarkdownText,
  parseMarkdownBlocks,
  tokenizeLinkedText,
} from "./LinkedText";

describe("MarkdownText", () => {
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

  it("parses six heading levels only when hashes start a line", () => {
    expect(
      parseMarkdownBlocks("# 一级\n### 三级\n###### 六级\n正文 # 不是标题"),
    ).toEqual([
      { type: "heading", level: 1, text: "一级" },
      { type: "heading", level: 3, text: "三级" },
      { type: "heading", level: 6, text: "六级" },
      { type: "paragraph", text: "正文 # 不是标题" },
    ]);
  });

  it("renders named HTTPS links with their chosen label", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="查看 [更新说明](https://outside.example/changelog)" />,
    );
    expect(html).toContain(">更新说明</a>");
    expect(html).not.toContain(">https://outside.example/changelog</a>");
  });

  it("keeps unsafe named links as plain text", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="[不要点击](javascript:alert(1))" />,
    );
    expect(html).toContain("[不要点击](javascript:alert(1))");
    expect(html).not.toContain("<a");
  });

  it("limits heading sizes in compact content", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="# 紧凑标题" variant="compact" />,
    );
    expect(html).toContain("text-base");
    expect(html).toContain("<h1");
  });

  it("renders safe external anchors and leaves other schemes as text", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
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
