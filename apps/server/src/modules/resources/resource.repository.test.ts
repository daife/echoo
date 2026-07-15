import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStorageProviderMatches,
  InvalidMediaUploadError,
  validateJpegUpload,
  validateUserMediaData,
} from "./resource.repository.js";

test("resource access rejects records from a different configured provider", () => {
  assert.doesNotThrow(() => assertStorageProviderMatches("s3", "s3"));
  assert.throws(
    () => assertStorageProviderMatches("s3", "local"),
    /database created for the configured storage backend/,
  );
  assert.throws(
    () => assertStorageProviderMatches("local", "s3"),
    /does not match configured provider/,
  );
});

test("JPEG uploads accept the 5 MiB boundary and reject larger or forged files", () => {
  const atLimit = new Uint8Array(5 * 1024 * 1024);
  atLimit.set([0xff, 0xd8, 0xff]);
  assert.doesNotThrow(() => validateJpegUpload(atLimit));

  const overLimit = new Uint8Array(5 * 1024 * 1024 + 1);
  overLimit.set([0xff, 0xd8, 0xff]);
  assert.throws(
    () => validateJpegUpload(overLimit),
    (error: unknown) =>
      error instanceof InvalidMediaUploadError &&
      error.message === "图片大小不能超过 5MB。",
  );
  assert.throws(
    () => validateJpegUpload(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
    /JPEG/,
  );
});

test("voice validation has no 5 MiB rule and uses playable duration", () => {
  const largeId3Bytes = 5 * 1024 * 1024;
  const largeShortVoice = createMp3(1, largeId3Bytes);
  assert.ok(largeShortVoice.length > 5 * 1024 * 1024);
  assert.doesNotThrow(() =>
    validateUserMediaData("end_user_voice", largeShortVoice),
  );

  const atBoundary = createMp3(60);
  assert.doesNotThrow(() =>
    validateUserMediaData("end_user_voice", atBoundary),
  );

  const tooLong = createMp3(60.2);
  assert.throws(
    () => validateUserMediaData("end_user_voice", tooLong),
    /不能超过 60 秒/,
  );
});

function createMp3(durationSeconds: number, id3PayloadBytes = 0) {
  const sampleRate = 44_100;
  const bitrateKbps = 64;
  const samplesPerFrame = 1_152;
  const frameLength = Math.floor((144_000 * bitrateKbps) / sampleRate);
  const frameCount = Math.floor(
    durationSeconds / (samplesPerFrame / sampleRate),
  );
  const id3HeaderBytes = id3PayloadBytes ? 10 : 0;
  const data = new Uint8Array(
    id3HeaderBytes + id3PayloadBytes + frameCount * frameLength,
  );
  let offset = 0;
  if (id3PayloadBytes) {
    data.set([0x49, 0x44, 0x33, 4, 0, 0], 0);
    data.set(toSynchsafe(id3PayloadBytes), 6);
    offset = id3HeaderBytes + id3PayloadBytes;
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    data.set([0xff, 0xfb, 0x50, 0], offset);
    offset += frameLength;
  }
  return data;
}

function toSynchsafe(value: number) {
  return Uint8Array.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}
