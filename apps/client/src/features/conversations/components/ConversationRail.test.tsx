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
  canPublishAsPublicAsset: true,
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

  it("marks the opened conversation with the white active treatment", () => {
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
    expect(html).toContain("bg-white text-[#09090b]");
    expect(html).toContain("text-black/55");
  });
});
