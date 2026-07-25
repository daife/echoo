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
