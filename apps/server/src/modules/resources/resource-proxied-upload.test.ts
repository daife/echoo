import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeEventRepository } from "../sync/change-event.repository.js";
import {
  ResourceRepository,
  type ResourceRecord,
} from "./resource.repository.js";
import type { ResourceStorage } from "./resource-storage.js";

test("proxied upload writes pending content to S3 storage", async () => {
  const writes: Array<{
    key: string;
    data: Uint8Array;
    mimeType: string;
  }> = [];
  const storage: ResourceStorage = {
    provider: "s3",
    async put(key, data, mimeType) {
      writes.push({ key, data, mimeType });
      return { size: data.byteLength };
    },
    async get() {
      throw new Error("not used");
    },
    async head() {
      return null;
    },
    async delete() {},
    async createReadStream() {
      throw new Error("not used");
    },
    async signPut() {
      return null;
    },
    async signGet() {
      return null;
    },
  };
  const repository = new ResourceRepository(
    storage,
    {} as ChangeEventRepository,
  );
  const content = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const pending: ResourceRecord = {
    id: "res_test",
    ownerUserId: "user_test",
    kind: "end_user_image",
    mimeType: "image/jpeg",
    originalFileName: "test.jpg",
    storageProvider: "s3",
    storageKey: "user_test/res_test/original.jpg",
    publicPath: "/api/resources/res_test/file",
    byteSize: content.length,
    status: "pending",
    createdAt: Date.now(),
  };
  repository.findById = async () => pending;

  const result = await repository.putPendingUploadForOwner(
    pending.ownerUserId,
    pending.id,
    content,
  );

  assert.equal(result, pending);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, pending.storageKey);
  assert.equal(writes[0]?.mimeType, pending.mimeType);
  assert.deepEqual(writes[0]?.data, content);
});
