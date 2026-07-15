import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./MessageBubble";

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
