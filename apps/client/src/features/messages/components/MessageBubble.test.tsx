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
  it("renders images at the fixed chat height without dimension metadata", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_image",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "image",
          mediaUrl: "/api/resources/resource_image/file",
        }}
      />,
    );

    expect(html).toContain('data-media-frame="image"');
    expect(html).toContain("h-80");
    expect(html).toContain("点击放大查看");
  });

  it("renders stickers at their smaller fixed chat height", () => {
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
    expect(html).toContain("h-44");
  });

  it("renders a fixed-height video preview that opens the media viewer", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "msg_video",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "video",
          mediaUrl: "/api/resources/resource_video/file",
        }}
      />,
    );

    expect(html).toContain('data-media-frame="video"');
    expect(html).toContain("h-80");
    expect(html).toContain("点击放大查看");
  });
});

describe("MessageBubble identity", () => {
  it("renders the figure avatar instead of a vertical marker", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        avatarUrl="https://example.test/figure.jpg"
        avatarAlt="小霁的头像"
        message={{
          id: "msg_agent",
          from: "agent",
          text: "晚上好。",
          createdAt: 1234,
          kind: "text",
        }}
      />,
    );

    expect(html).toContain('data-identity-avatar="image"');
    expect(html).toContain("小霁的头像");
    expect(html).not.toContain("h-7 w-1");
  });

  it("keeps an empty user avatar when no image is available", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        avatarAlt="我的头像"
        message={{
          id: "msg_me",
          from: "me",
          text: "你好。",
          createdAt: 1234,
          kind: "text",
        }}
      />,
    );

    expect(html).toContain('data-identity-avatar="empty"');
    expect(html).not.toContain("Robot");
  });

  it("does not render an avatar for memory summaries", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        avatarUrl="https://example.test/figure.jpg"
        message={{
          id: "msg_memory",
          from: "agent",
          text: "",
          createdAt: 1234,
          kind: "memory-summary",
        }}
      />,
    );

    expect(html).not.toContain("data-identity-avatar");
  });
});
