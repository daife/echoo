import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@echoo/shared";
import { ConversationRail } from "./ConversationRail";

const agent = {
  id: "agent_1",
  ownerUserId: "user_1",
  type: "slice-figure",
  name: "小霁",
  avatarResourcePath: "/api/resources/avatar/file",
  introduction: "在这里。",
  attributes: [],
  tags: [],
  linkedAgentIds: [],
  isPublic: false,
  origin: { kind: "original" },
  conversationId: "conversation_1",
  createdAt: 1,
  updatedAt: 1,
  detail: {
    prologueHtml: "",
    currentSituation: "",
    openingLine: "",
    linkedAgentIds: [],
    persona: "安静的人",
    background: "",
    personality: "",
    responseStyle: "",
    systemPrompt: "",
    memorySummaryPrompt: "",
  },
} as Agent;

describe("ConversationRail identity", () => {
  it("keeps the desktop rail constrained so its conversation list can scroll", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[agent]}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );

    expect(html).toContain('<aside class="hidden min-h-0 min-w-0 md:block">');
    expect(html).toContain(
      'class="min-h-0 flex-1 overflow-y-auto p-2 no-scrollbar"',
    );
  });

  it("uses the role avatar when one exists", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[agent]}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(html).toContain('data-identity-avatar="image"');
    expect(html).not.toContain("Robot");
  });

  it("leaves the avatar empty without an image", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[{ ...agent, avatarResourcePath: undefined }]}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(html).toContain('data-identity-avatar="empty"');
  });

  it("marks the opened conversation with a white outline treatment", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[agent]}
        selectedAgentId={agent.id}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("border-white/70 bg-white/[0.035] text-white");
    expect(html).toContain("text-white/62");
    expect(html).not.toContain("bg-white text-[#09090b]");
  });

  it("shows an accessible dot instead of a numeric badge for unread messages", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[agent]}
        conversations={[
          {
            id: agent.conversationId,
            title: agent.name,
            type: "slice-figure",
            unreadCount: 3,
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(html).toContain("小霁，有新消息");
    expect(html).toContain("bg-[#ff5b63]");
    expect(html).not.toContain(">3<");
  });

  it("filters bracketed directions from the last message preview", () => {
    const html = renderToStaticMarkup(
      <ConversationRail
        agents={[agent]}
        conversations={[
          {
            id: agent.conversationId,
            title: agent.name,
            type: "slice-figure",
            lastMessagePreview: "你好【轻声】 [挥手] 很高兴见到你",
            unreadCount: 0,
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        onOpenAgent={vi.fn()}
        onOpenBindings={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );

    expect(html).toContain("你好 很高兴见到你");
    expect(html).not.toContain("轻声");
    expect(html).not.toContain("挥手");
  });
});
