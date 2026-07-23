import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PostCard } from "./PostCard";

describe("PostCard", () => {
  it("shows only counters and directs comments to the detail view", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_1",
          author: { id: "user_1", displayName: "Aether", isAdmin: false },
          body: "动态正文",
          images: [],
          likeCount: 2,
          commentCount: 7,
          viewerHasLiked: false,
          canEdit: false,
          canDelete: false,
          createdAt: 1,
          updatedAt: 1,
        }}
        onOpen={vi.fn()}
      />,
    );
    expect(html).toContain("进入动态查看评论");
    expect(html).toContain("动态正文");
    expect(html).not.toContain("评论正文");
  });

  it("shows a prominent administrator badge for administrator authors", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_admin",
          author: { id: "user_admin", displayName: "Echoo", isAdmin: true },
          body: "官方动态",
          images: [],
          likeCount: 0,
          commentCount: 0,
          viewerHasLiked: false,
          canEdit: false,
          canDelete: false,
          createdAt: 1,
          updatedAt: 1,
        }}
        onOpen={vi.fn()}
      />,
    );
    expect(html).toContain('data-admin-avatar="true"');
    expect(html).toContain("管理员账号");
    expect(html).toContain("管理员");
  });
});
