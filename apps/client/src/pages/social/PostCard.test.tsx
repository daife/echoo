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
          content: [{ type: "text", text: "动态正文" }],
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
    expect(html).toContain('aria-label="查看评论"');
    expect(html).not.toContain("进入动态查看评论");
    expect(html).toContain("动态正文");
    expect(html).not.toContain("评论正文");
  });

  it("shows a prominent administrator badge for administrator authors", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_admin",
          author: { id: "user_admin", displayName: "Echoo", isAdmin: true },
          content: [{ type: "text", text: "官方动态" }],
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

  it("renders body links without nesting them in a button", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_links",
          author: { id: "user_1", displayName: "Aether", isAdmin: false },
          content: [
            { type: "text", text: "看看 https://echoo.example/?card=asset_1" },
          ],
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
    expect(html).toContain('href="https://echoo.example/?card=asset_1"');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<a/s);
  });

  it("renders each dynamic image as its own custom preview trigger", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_images",
          author: { id: "user_1", displayName: "Aether", isAdmin: false },
          content: [
            { type: "text", text: "配图动态" },
            {
              type: "image",
              resourceId: "res_1",
              resourcePath: "/api/resources/res_1/file",
            },
            {
              type: "image",
              resourceId: "res_2",
              resourcePath: "/api/resources/res_2/file",
            },
          ],
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

    expect(html.match(/data-media-frame="image"/g)).toHaveLength(2);
    expect(html).toContain("Aether 的动态图片 1，点击放大查看");
    expect(html).toContain("Aether 的动态图片 2，点击放大查看");
  });

  it("renders text, image, and audio blocks in authored order", () => {
    const html = renderToStaticMarkup(
      <PostCard
        post={{
          id: "post_mixed",
          author: { id: "user_1", displayName: "Aether", isAdmin: false },
          content: [
            { type: "text", text: "之前" },
            {
              type: "image",
              resourceId: "res_image",
              resourcePath: "/api/resources/res_image/file",
            },
            { type: "text", text: "之后" },
            {
              type: "audio",
              resourceId: "res_audio",
              resourcePath: "/api/resources/res_audio/file",
              durationSeconds: 12,
            },
          ],
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
    const imageIndex = html.indexOf('data-media-frame="image"');
    const audioIndex = html.indexOf("<audio");
    expect(html.indexOf("之前")).toBeLessThan(imageIndex);
    expect(imageIndex).toBeLessThan(html.indexOf("之后"));
    expect(html.indexOf("之后")).toBeLessThan(audioIndex);
    expect(html).toContain("0:12");
  });
});
