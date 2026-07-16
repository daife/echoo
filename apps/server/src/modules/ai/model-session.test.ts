import assert from "node:assert/strict";
import test from "node:test";
import { modelSessionId } from "./model-session.js";

test("builds stable, DeepSeek-safe role-specific model session IDs", () => {
  const conversationId = "conversation_1";
  assert.equal(
    modelSessionId(conversationId, "decision"),
    modelSessionId(conversationId, "decision"),
  );
  assert.match(
    modelSessionId(conversationId, "decision"),
    /^pf-[a-zA-Z0-9_-]{16}-d$/,
  );
  assert.match(modelSessionId(conversationId, "visual"), /-v$/);
  assert.match(modelSessionId(conversationId, "audio"), /-a$/);
  assert.match(modelSessionId(conversationId, "image-generation"), /-ig$/);
  assert.match(modelSessionId(conversationId, "image-optimizer"), /-oi$/);
  assert.match(modelSessionId(conversationId, "voice-optimizer"), /-ov$/);
});
