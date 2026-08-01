import assert from "node:assert/strict";
import test from "node:test";
import { parseFirstJsonObject } from "./prime-json-response.js";

test("ignores non-JSON content after the first complete object", () => {
  assert.deepEqual(parseFirstJsonObject('{"actions":[]}\"}'), {
    actions: [],
  });
});

test("ignores model prose and Markdown around the first complete object", () => {
  assert.deepEqual(
    parseFirstJsonObject('结果如下：```json\n{"figureMood":"开心"}\n```'),
    { figureMood: "开心" },
  );
});

test("does not treat braces inside JSON strings as object boundaries", () => {
  assert.deepEqual(
    parseFirstJsonObject(
      '{"text":"括号 } 和转义引号 \\\" 都属于文本"} trailing',
    ),
    { text: '括号 } 和转义引号 " 都属于文本' },
  );
});

test("still rejects a truncated JSON object", () => {
  assert.throws(() => parseFirstJsonObject('{"actions":['), SyntaxError);
});
