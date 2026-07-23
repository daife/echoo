import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationHeaderTitle } from "./ConversationHeaderTitle";

describe("ConversationHeaderTitle", () => {
  it("places the conversation name above its muted context label", () => {
    const html = renderToStaticMarkup(
      <ConversationHeaderTitle title="测试" subtitle="本初世界" />,
    );

    expect(html.indexOf("测试")).toBeLessThan(html.indexOf("本初世界"));
    expect(html).toContain("text-base font-semibold");
    expect(html).toContain("text-xs leading-4 text-white/45");
  });
});
