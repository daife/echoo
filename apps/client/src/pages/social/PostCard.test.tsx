import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PostCard } from "./PostCard";

describe("PostCard", () => {
  it("shows only counters and directs comments to the detail view", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_1",
          author: { id: "user_1", displayName: "Aether" },
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
});
