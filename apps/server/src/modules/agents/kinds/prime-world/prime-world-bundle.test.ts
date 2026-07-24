import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPrimeWorldDetail } from "@echoo/shared";
import { materializePrimeWorldBundle } from "./prime-world-bundle.js";

test("materializePrimeWorldBundle rewrites embedded resources and exposes rollback", async () => {
  const detail = createDefaultPrimeWorldDetail();
  detail.presentation.startView.background = { resourceId: "bundle:resource-1" };
  const deleted: string[] = [];
  const resources = {
    async savePrimeWorldBundleResource() {
      return { id: "resource-saved", publicPath: "/resources/saved.png" };
    },
    async deleteOwnedByPublicPath(_ownerUserId: string, publicPath: string) {
      deleted.push(publicPath);
    },
  };
  const value = await materializePrimeWorldBundle("user-1", {
    format: "echoo-prime-world",
    formatVersion: 1,
    name: "雾港",
    attributes: [],
    tags: ["冒险"],
    introduction: "测试世界",
    isPublic: false,
    detail,
    resources: [{
      key: "resource-1",
      usageKind: "world",
      mimeType: "image/png",
      fileName: "saved.png",
      dataBase64: "AA==",
    }],
  }, resources as any);
  assert.equal(
    value.request.detail.presentation.startView.background?.resourceId,
    "resource-saved",
  );
  assert.equal(value.request.name, "雾港");
  await value.cleanup();
  assert.deepEqual(deleted, ["/resources/saved.png"]);
});

test("materializePrimeWorldBundle cleans saved resources when a reference is missing", async () => {
  const detail = createDefaultPrimeWorldDetail();
  detail.presentation.startView.background = { resourceId: "bundle:resource-2" };
  const deleted: string[] = [];
  const resources = {
    async savePrimeWorldBundleResource() {
      return { id: "resource-saved", publicPath: "/resources/saved.png" };
    },
    async deleteOwnedByPublicPath(_ownerUserId: string, publicPath: string) {
      deleted.push(publicPath);
    },
  };
  await assert.rejects(
    materializePrimeWorldBundle("user-1", {
      format: "echoo-prime-world",
      formatVersion: 1,
      name: "雾港",
      isPublic: false,
      detail,
      resources: [{
        key: "resource-1",
        usageKind: "world",
        mimeType: "image/png",
        fileName: "saved.png",
        dataBase64: "AA==",
      }],
    }, resources as any),
    /BUNDLE_RESOURCE_MISSING/,
  );
  assert.deepEqual(deleted, ["/resources/saved.png"]);
});
