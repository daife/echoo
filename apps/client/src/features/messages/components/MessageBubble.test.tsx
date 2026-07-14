import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble runtime errors", () => {
  it("renders the error as a centered timeline notice without a bubble", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_error",
          from: "system",
          text: "openrouter API key is not configured.",
          createdAt: 1234,
          kind: "runtime-error",
        }}
      />,
    );

    expect(html).toContain("运行失败：openrouter API key is not configured.");
    expect(html).toContain("self-center");
    expect(html).toContain("text-red-300/75");
    expect(html).not.toContain("rounded-xl");
  });
});
