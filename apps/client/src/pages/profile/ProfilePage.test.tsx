import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@echoo/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ProfileEditorDialog,
  ProfilePage,
  PublicAssetCreateDialog,
} from "./ProfilePage";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: "user_1",
      email: "aether@example.test",
      displayName: "Aether",
      signature: "安静地共创角色。",
      isAdmin: false,
      createdAt: 1,
    },
  }),
}));

vi.mock("../../app/providers/ServicesProvider", () => ({
  useServices: () => ({
    socialService: { listUserPosts: vi.fn() },
  }),
}));

const originalAgent: Agent = {
  id: "agent_original",
  ownerUserId: "user_1",
  type: "slice-figure",
  name: "原创小霁",
  avatarResourcePath: "/api/resources/avatar/original",
  coverResourcePath: "/api/resources/cover/original",
  introduction: "由用户直接创建的会话。",
  attributes: [{ key: "关系", value: "朋友" }],
  tags: ["日常陪伴"],
  isPublic: false,
  origin: { kind: "original" },
  conversationId: "conversation_original",
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
};

const publicAssetAgent: Agent = {
  ...originalAgent,
  id: "agent_public",
  name: "公共林晚",
  origin: { kind: "public-asset", assetId: "asset_1" },
  conversationId: "conversation_public",
};

describe("ProfileEditorDialog", () => {
  it("prefills persisted profile fields and exposes avatar controls", () => {
    const html = renderToStaticMarkup(
      <ProfileEditorDialog
        user={{
          id: "user_1",
          email: "aether@example.test",
          displayName: "Aether",
          signature: "安静地共创角色。",
          avatarUrl: "/api/resources/avatar/file",
          isAdmin: false,
          createdAt: 1,
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('value="Aether"');
    expect(html).toContain("安静地共创角色。");
    expect(html).toContain("选择图片");
    expect(html).toContain("移除头像");
    expect(html).toContain("max-w-[17rem] grid-cols-2");
    expect(html).toContain("flex h-10 cursor-pointer items-center justify-center");
    expect(html).toContain("保存修改");
  });
});

describe("PublicAssetCreateDialog", () => {
  it("creates public assets independently and only imports original conversations", () => {
    const html = renderToStaticMarkup(
      <PublicAssetCreateDialog
        agents={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(html).toContain("从空白创建");
    expect(html).toContain("从原创会话导入");
    expect(html).toContain("公共资产独立于原创会话");
    expect(html).toContain("创建并进入草稿编辑器");
  });
});

describe("ProfilePage personal conversations", () => {
  it("groups conversations by origin and only links public-origin cards to details", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ProfilePage
          agents={[originalAgent, publicAssetAgent]}
          isLoadingAgents={false}
          onOpenAgent={vi.fn()}
          onOpenSettings={vi.fn()}
          publicAssets={[]}
          onCreatePublicDraft={vi.fn()}
          onManagePublicAsset={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenPost={vi.fn()}
          onOpenUser={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("个人会话");
    expect(html).toContain("原创会话");
    expect(html).toContain("从公共资产添加的会话");
    expect(html).toContain("查看 公共林晚 的公共资产详情");
    expect(html).not.toContain("查看 原创小霁 的公共资产详情");
    expect(html).toContain("进入与 原创小霁 的会话");
    expect(html).toContain("进入与 公共林晚 的会话");
    expect(html).toContain('data-identity-avatar="image"');
    expect(html).toContain("关系: 朋友");
    expect(html).toContain("#日常陪伴");
    expect(html).toContain("@min-[760px]/profile:grid-cols-2");
  });
});
