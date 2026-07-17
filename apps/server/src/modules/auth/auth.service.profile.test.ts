import assert from "node:assert/strict";
import test from "node:test";
import type { AgentResourceUpload } from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { AuthService } from "./auth.service.js";

const avatarUpload: AgentResourceUpload = {
  fileName: "avatar.jpg",
  mimeType: "image/jpeg",
  dataBase64: "base64",
};

const existingUser = {
  id: "user_1",
  email: "aether@example.test",
  displayName: "Aether",
  signature: "旧签名",
  avatarUrl: "/api/resources/old/file",
  passwordHash: "hash",
  createdAt: 1,
  updatedAt: 1,
};

test("profile avatar replacement links the new resource and deletes the old one", async () => {
  const updates: unknown[] = [];
  const deleted: string[] = [];
  const users = {
    findById: async () => existingUser,
    updateProfile: async (_userId: string, input: unknown) => {
      updates.push(input);
      return {
        ...existingUser,
        avatarUrl: "/api/resources/new/file",
        updatedAt: 2,
      };
    },
  };
  const resources = {
    saveImage: async () => ({
      id: "resource_new",
      publicPath: "/api/resources/new/file",
    }),
    deleteOwnedByPublicPath: async (_userId: string, path: string) => {
      deleted.push(path);
      return true;
    },
  };
  const service = createProfileService(users, resources);

  const profile = await service.updateProfile("user_1", {
    avatar: avatarUpload,
  });

  assert.deepEqual(updates, [{ avatarResourceId: "resource_new" }]);
  assert.deepEqual(deleted, ["/api/resources/old/file"]);
  assert.equal(profile.avatarUrl, "/api/resources/new/file");
});

test("profile avatar removal clears the link and deletes the old resource", async () => {
  const updates: unknown[] = [];
  const deleted: string[] = [];
  const users = {
    findById: async () => existingUser,
    updateProfile: async (_userId: string, input: unknown) => {
      updates.push(input);
      const { avatarUrl: _avatarUrl, ...withoutAvatar } = existingUser;
      return { ...withoutAvatar, updatedAt: 2 };
    },
  };
  const resources = {
    saveImage: async () => {
      throw new Error("avatar removal must not upload");
    },
    deleteOwnedByPublicPath: async (_userId: string, path: string) => {
      deleted.push(path);
      return true;
    },
  };
  const service = createProfileService(users, resources);

  const profile = await service.updateProfile("user_1", { avatar: null });

  assert.deepEqual(updates, [{ avatarResourceId: null }]);
  assert.deepEqual(deleted, ["/api/resources/old/file"]);
  assert.equal(profile.avatarUrl, undefined);
});

test("profile update failure removes a newly saved avatar", async () => {
  const deleted: string[] = [];
  const users = {
    findById: async () => existingUser,
    updateProfile: async () => {
      throw new Error("database failed");
    },
  };
  const resources = {
    saveImage: async () => ({
      id: "resource_new",
      publicPath: "/api/resources/new/file",
    }),
    deleteOwnedByPublicPath: async (_userId: string, path: string) => {
      deleted.push(path);
      return true;
    },
  };
  const service = createProfileService(users, resources);

  await assert.rejects(
    service.updateProfile("user_1", { avatar: avatarUpload }),
    /database failed/,
  );
  assert.deepEqual(deleted, ["/api/resources/new/file"]);
});

function createProfileService(users: object, resources: object) {
  return new AuthService(
    {} as FastifyInstance,
    users as never,
    {} as never,
    {} as never,
    resources as never,
  );
}
