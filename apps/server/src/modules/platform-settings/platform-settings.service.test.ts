import assert from "node:assert/strict";
import test from "node:test";
import {
  PlatformSettingsService,
  parseJson,
} from "./platform-settings.service.js";

test("parses JSON values returned as MySQL buffers", () => {
  assert.equal(parseJson(Buffer.from('"7.2"')), "7.2");
  assert.deepEqual(parseJson(Buffer.from('{"value":"7.2"}')), {
    value: "7.2",
  });
});

test("reads numeric rate values returned by legacy MySQL JSON decoding", async () => {
  const service = new PlatformSettingsService();
  Object.defineProperty(service, "find", {
    value: async () => ({ value_json: 7.2 }),
  });

  assert.equal(await service.getUsdToCnyRate(), "7.2");
});

test("site content defaults to an empty announcement", async () => {
  const service = new PlatformSettingsService();
  Object.defineProperty(service, "find", { value: async () => null });

  assert.deepEqual(await service.getSiteContent(), { announcement: "" });
});

test("site content is trimmed, saved, and returned", async () => {
  const service = new PlatformSettingsService();
  let saved: unknown;
  Object.defineProperty(service, "save", {
    value: async (_key: string, value: unknown) => {
      saved = value;
    },
  });

  const result = await service.setSiteContent({
    announcement: "  # 更新\n[查看详情](https://echoo.example)  ",
  });
  assert.deepEqual(result, {
    announcement: "# 更新\n[查看详情](https://echoo.example)",
  });
  assert.deepEqual(saved, result);
});

test("site content rejects announcements longer than 4000 characters", async () => {
  const service = new PlatformSettingsService();
  await assert.rejects(() =>
    service.setSiteContent({ announcement: "x".repeat(4001) }),
  );
});
