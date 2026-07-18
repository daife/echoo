import assert from "node:assert/strict";
import test from "node:test";
import { SocialService } from "./social.service.js";

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
});
