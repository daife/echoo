import assert from "node:assert/strict";
import test from "node:test";
import { SocialActionForbiddenError, SocialService } from "./social.service.js";

test("generic social actions accept public posts", async () => {
  const repository = {
    findObject: async () => ({
      id: "post_1",
      object_type: "post",
      asset_status: null,
      owner_user_id: "user_1",
      viewer_can_access: 1,
    }),
    setLike: async () => ({ likeCount: 1, viewerHasLiked: true }),
    createComment: async () => "comment_1",
    findComment: async () => ({
      id: "comment_1",
      object_id: "post_1",
      author_user_id: "user_2",
      display_name: "Reader",
      avatar_url: null,
      is_admin: 1,
      parent_comment_id: null,
      body: "hello",
      status: "visible",
      object_owner_user_id: "user_1",
      created_at: 1,
      updated_at: 1,
    }),
  };
  const service = new SocialService(repository as never);
  assert.deepEqual(await service.setLike("post_1", "user_2", true), {
    likeCount: 1,
    viewerHasLiked: true,
  });
  const comment = await service.createComment({
    objectId: "post_1",
    authorUserId: "user_2",
    body: "hello",
  });
  assert.equal(comment.body, "hello");
  assert.equal(comment.canEdit, true);
  assert.equal(comment.author.isAdmin, true);
});

test("public assets reuse likes and comments while blocking new activity after unlisting", async () => {
  let status: "published" | "unlisted" = "published";
  const repository = {
    findObject: async () => ({
      id: "asset_1",
      object_type: "public_asset",
      asset_status: status,
      owner_user_id: "creator",
      viewer_can_access: 1,
    }),
    setLike: async () => ({ likeCount: 1, viewerHasLiked: true }),
    createComment: async () => "comment_1",
    findComment: async () => ({
      id: "comment_1",
      object_id: "asset_1",
      author_user_id: "reader",
      display_name: "Reader",
      avatar_url: null,
      is_admin: 0,
      parent_comment_id: null,
      body: "很好玩",
      status: "visible",
      object_owner_user_id: "creator",
      created_at: 1,
      updated_at: 1,
    }),
  };
  const service = new SocialService(repository as never);

  assert.equal(
    (await service.setLike("asset_1", "reader", true)).viewerHasLiked,
    true,
  );
  assert.equal(
    (
      await service.createComment({
        objectId: "asset_1",
        authorUserId: "reader",
        body: "很好玩",
      })
    ).body,
    "很好玩",
  );

  status = "unlisted";
  await assert.rejects(
    service.setLike("asset_1", "reader", true),
    SocialActionForbiddenError,
  );
  await assert.rejects(
    service.createComment({
      objectId: "asset_1",
      authorUserId: "reader",
      body: "新评论",
    }),
    SocialActionForbiddenError,
  );
});
