import assert from "node:assert/strict";
import test from "node:test";
import {
  FollowForbiddenError,
  PublicUserNotFoundError,
  UsersService,
} from "./users.service.js";

test("users cannot follow themselves", async () => {
  const service = new UsersService({} as never);
  await assert.rejects(
    () => service.setFollowing("user_1", "user_1", true),
    FollowForbiddenError,
  );
});

test("follow and unfollow preserve idempotent repository state", async () => {
  let following = false;
  const service = new UsersService({
    setFollowing: async (_viewer: string, _target: string, next: boolean) => {
      following = next;
      return { following, followerCount: following ? 1 : 0, isMutual: false };
    },
  } as never);
  assert.equal(
    (await service.setFollowing("user_1", "user_2", true)).following,
    true,
  );
  assert.equal(
    (await service.setFollowing("user_1", "user_2", true)).followerCount,
    1,
  );
  assert.equal(
    (await service.setFollowing("user_1", "user_2", false)).following,
    false,
  );
});

test("missing follow target returns a public not-found error", async () => {
  const service = new UsersService({ setFollowing: async () => null } as never);
  await assert.rejects(
    () => service.setFollowing("user_1", "missing", true),
    PublicUserNotFoundError,
  );
});
