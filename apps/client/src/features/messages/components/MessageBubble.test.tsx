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

describe("MessageBubble media layout", () => {
  it("reserves the final image aspect ratio before the source resolves", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_image",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "image",
          mediaUrl: "/api/resources/resource_image/file",
          mediaWidth: 900,
          mediaHeight: 1_600,
        }}
      />,
    );

    expect(html).toContain('data-media-frame="image"');
    expect(html).toContain("width:270px");
    expect(html).toContain("aspect-ratio:270 / 480");
  });

  it("keeps a stable fallback frame when dimensions are unavailable", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_sticker",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "sticker",
          mediaUrl: "/api/resources/resource_sticker/file",
        }}
      />,
    );

    expect(html).toContain('data-media-frame="sticker"');
    expect(html).toContain("width:176px");
    expect(html).toContain("aspect-ratio:176 / 176");
  });
});
