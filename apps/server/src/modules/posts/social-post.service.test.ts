import assert from "node:assert/strict";
import test from "node:test";
import type { SocialPostContentInput } from "@echoo/shared";
import {
  normalizePostContent,
  SocialPostForbiddenError,
  SocialPostNotFoundError,
  SocialPostService,
} from "./social-post.service.js";

const readyImage = {
  id: "image_1",
  ownerUserId: "user_1",
  kind: "end_user_image",
  mimeType: "image/jpeg",
  status: "ready",
};
const readyAudio = {
  ...readyImage,
  id: "audio_1",
  kind: "end_user_voice",
  mimeType: "audio/mpeg",
};

test("post requires content and accepts media-only posts", async () => {
  let created: SocialPostContentInput[] | undefined;
  const service = new SocialPostService(
    {
      create: async (_authorUserId: string, content: SocialPostContentInput[]) => {
        created = content;
        return "post_1";
      },
      find: async () => ({ id: "post_1" }),
    } as never,
    {
      findById: async (id: string) => (id.startsWith("audio") ? readyAudio : readyImage),
    } as never,
  );

  await assert.rejects(
    () => service.create("user_1", [{ type: "text", text: "  " }]),
    SocialPostForbiddenError,
  );
  await service.create("user_1", [{ type: "audio", resourceId: "audio_1" }]);
  assert.deepEqual(created, [{ type: "audio", resourceId: "audio_1" }]);
});

test("post enforces separate image and audio limits", async () => {
  const service = new SocialPostService(
    {} as never,
    {
      findById: async (id: string) =>
        id.startsWith("audio")
          ? { ...readyAudio, id }
          : { ...readyImage, id },
    } as never,
  );
  await assert.rejects(
    () =>
      service.create(
        "user_1",
        Array.from({ length: 4 }, (_, index) => ({
          type: "image" as const,
          resourceId: `image_${index}`,
        })),
      ),
    SocialPostForbiddenError,
  );
  await assert.rejects(
    () =>
      service.create(
        "user_1",
        Array.from({ length: 11 }, (_, index) => ({
          type: "audio" as const,
          resourceId: `audio_${index}`,
        })),
      ),
    SocialPostForbiddenError,
  );
});

test("post rejects repeated, foreign, unfinished, or mismatched media", async () => {
  const service = new SocialPostService(
    {} as never,
    {
      findById: async (id: string) =>
        id === "foreign"
          ? { ...readyImage, ownerUserId: "user_2" }
          : id === "pending"
            ? { ...readyImage, status: "processing" }
            : id === "audio_1"
              ? readyAudio
              : readyImage,
    } as never,
  );
  await assert.rejects(
    () =>
      service.create("user_1", [
        { type: "image", resourceId: "image_1" },
        { type: "audio", resourceId: "image_1" },
      ]),
    SocialPostForbiddenError,
  );
  for (const resourceId of ["foreign", "pending"])
    await assert.rejects(
      () => service.create("user_1", [{ type: "image", resourceId }]),
      SocialPostForbiddenError,
    );
  await assert.rejects(
    () => service.create("user_1", [{ type: "image", resourceId: "audio_1" }]),
    SocialPostForbiddenError,
  );
});

test("post normalizes empty and adjacent text blocks and limits aggregate text", async () => {
  assert.deepEqual(
    normalizePostContent([
      { type: "text", text: "hello" },
      { type: "text", text: " " },
      { type: "text", text: "world" },
      { type: "image", resourceId: " image_1 " },
    ]),
    [
      { type: "text", text: "helloworld" },
      { type: "image", resourceId: "image_1" },
    ],
  );
  const service = new SocialPostService({} as never, {} as never);
  await assert.rejects(
    () =>
      service.create("user_1", [
        { type: "text", text: "x".repeat(3000) },
        { type: "image", resourceId: "image_1" },
        { type: "text", text: "y".repeat(1001) },
      ]),
    SocialPostForbiddenError,
  );
});

test("post update and delete do not reveal another author's post", async () => {
  const service = new SocialPostService(
    { update: async () => false, delete: async () => false } as never,
    {} as never,
  );
  await assert.rejects(
    () => service.update("user_2", "post_1", [{ type: "text", text: "changed" }]),
    SocialPostNotFoundError,
  );
  await assert.rejects(
    () => service.delete("user_2", "post_1"),
    SocialPostNotFoundError,
  );
});
