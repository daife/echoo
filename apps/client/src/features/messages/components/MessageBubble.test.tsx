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

describe("MessageBubble transfers", () => {
  it("renders a pending figure transfer with receive and reject controls", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_transfer",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "transfer",
          transferAmount: 12.3,
          transferCurrency: "CNY",
          transferStatus: "pending",
          transferDirection: "paid",
          transferNote: "咖啡钱",
        }}
        onResolveTransfer={() => undefined}
      />,
    );

    expect(html).toContain("¥12.30");
    expect(html).toContain("咖啡钱");
    expect(html).toContain("收款");
    expect(html).toContain("拒收");
  });
});
