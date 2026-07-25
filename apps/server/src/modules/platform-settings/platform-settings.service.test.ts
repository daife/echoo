import assert from "node:assert/strict";
import test from "node:test";
import { parseJson } from "./platform-settings.service.js";

test("parses JSON values returned as MySQL buffers", () => {
  assert.equal(parseJson(Buffer.from('"7.2"')), "7.2");
  assert.deepEqual(parseJson(Buffer.from('{"value":"7.2"}')), {
    value: "7.2",
  });
});
