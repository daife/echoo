import assert from "node:assert/strict";
import test from "node:test";
import {
  SocialPostForbiddenError,
  SocialPostNotFoundError,
  SocialPostService,
} from "./social-post.service.js";

const readyImage = {
  id: "res_1",
  ownerUserId: "user_1",
  kind: "end_user_image",
  mimeType: "image/jpeg",
  status: "ready",
};

test("post requires text or at least one image and accepts image-only posts", async () => {
  let created: { body: string; resourceIds: string[] } | undefined;
  const service = new SocialPostService(
    {
      create: async (
        _authorUserId: string,
        body: string,
        resourceIds: string[],
      ) => {
        created = { body, resourceIds };
        return "post_1";
      },
      find: async () => ({ id: "post_1" }),
    } as never,
    { findById: async () => readyImage } as never,
  );

  await assert.rejects(
    () => service.create("user_1", "  ", []),
    SocialPostForbiddenError,
  );
  await service.create("user_1", "", ["res_1"]);
  assert.deepEqual(created, { body: "", resourceIds: ["res_1"] });
});

test("post rejects more than three, repeated, foreign, or unfinished images", async () => {
  const service = new SocialPostService(
    {} as never,
    {
      findById: async (id: string) =>
        id === "foreign"
          ? { ...readyImage, ownerUserId: "user_2" }
          : id === "pending"
            ? { ...readyImage, status: "processing" }
            : readyImage,
    } as never,
  );
  await assert.rejects(
    () => service.create("user_1", "x", ["1", "2", "3", "4"]),
    SocialPostForbiddenError,
  );
  await assert.rejects(
    () => service.create("user_1", "x", ["res_1", "res_1"]),
    SocialPostForbiddenError,
  );
  await assert.rejects(
    () => service.create("user_1", "x", ["foreign"]),
    SocialPostForbiddenError,
  );
  await assert.rejects(
    () => service.create("user_1", "x", ["pending"]),
    SocialPostForbiddenError,
  );
});

test("post update and delete do not reveal another author's post", async () => {
  const service = new SocialPostService(
    { update: async () => false, delete: async () => false } as never,
    {} as never,
  );
  await assert.rejects(
    () => service.update("user_2", "post_1", "changed", []),
    SocialPostNotFoundError,
  );
  await assert.rejects(
    () => service.delete("user_2", "post_1"),
    SocialPostNotFoundError,
  );
});
