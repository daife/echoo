import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidMediaUploadError,
  validateUserMediaData,
} from "./resource.repository.js";

test("video validation accepts a non-empty file within 12 MB", () => {
  const mp4Header = new Uint8Array([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.equal(
    validateUserMediaData("end_user_video", mp4Header, "video/mp4"),
    undefined,
  );
});

test("video validation rejects empty and oversized files", () => {
  assert.throws(
    () => validateUserMediaData("end_user_video", new Uint8Array()),
    InvalidMediaUploadError,
  );
  assert.throws(
    () =>
      validateUserMediaData(
        "end_user_video",
        new Uint8Array(12 * 1024 * 1024 + 1),
        "video/mp4",
      ),
    /视频大小不能超过 12MB/,
  );
  assert.throws(
    () =>
      validateUserMediaData(
        "end_user_video",
        new Uint8Array([0, 1, 2, 3]),
        "video/mp4",
      ),
    /格式不匹配/,
  );
});
