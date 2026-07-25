import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceCloneSchema } from "@echoo/shared/voice-clones";
import { validateUserMediaData } from "../resources/resource.repository.js";

test("voice clone input requires explicit consent and bounded metadata", () => {
  assert.equal(
    createVoiceCloneSchema.safeParse({
      name: "旁白",
      description: "清晰自然",
      sampleResourceId: "res_sample",
      consentConfirmed: true,
    }).success,
    true,
  );
  assert.equal(
    createVoiceCloneSchema.safeParse({
      name: "旁白",
      sampleResourceId: "res_sample",
      consentConfirmed: false,
    }).success,
    false,
  );
});

test("voice clone samples enforce the independent 10 to 90 second window", () => {
  const tenSeconds = mp3Frames(383);
  const ninetySeconds = mp3Frames(3_445);
  const tenSecondDuration = validateUserMediaData(
    "voice_clone_sample",
    tenSeconds,
    "audio/mpeg",
  );
  const ninetySecondDuration = validateUserMediaData(
    "voice_clone_sample",
    ninetySeconds,
    "audio/mpeg",
  );
  assert.ok(tenSecondDuration !== undefined && tenSecondDuration >= 10);
  assert.ok(ninetySecondDuration !== undefined && ninetySecondDuration <= 90.1);
  assert.throws(
    () => validateUserMediaData("voice_clone_sample", mp3Frames(382), "audio/mpeg"),
    /不能少于 10 秒/,
  );
  assert.throws(
    () => validateUserMediaData("voice_clone_sample", mp3Frames(3_450), "audio/mpeg"),
    /不能超过 90 秒/,
  );
});

function mp3Frames(count: number) {
  const frameLength = 417;
  const result = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * frameLength;
    result.set([0xff, 0xfb, 0x90, 0], offset);
  }
  return result;
}
