import assert from "node:assert/strict";
import test from "node:test";
import {
  FISH_AUDIO_PAID_USD_PER_MILLION_UTF8_BYTES,
  fishAudioCostUsd,
  fishAudioPricePerMillionUtf8Bytes,
} from "./fish-audio-tts.service.js";

test("Fish Audio charges paid models by UTF-8 bytes", () => {
  assert.equal(FISH_AUDIO_PAID_USD_PER_MILLION_UTF8_BYTES, 15);
  assert.equal(fishAudioCostUsd("A", "s2.1-pro"), 15 / 1_000_000);
  assert.equal(fishAudioCostUsd("中", "s2.1-pro"), 45 / 1_000_000);
  assert.equal(fishAudioCostUsd("😀", "s1"), 60 / 1_000_000);
});

test("only explicitly listed Fish Audio models are free", () => {
  assert.equal(fishAudioPricePerMillionUtf8Bytes("s2.1-pro-free"), 0);
  assert.equal(fishAudioCostUsd("中文", "S2.1-PRO-FREE"), 0);
  assert.equal(fishAudioPricePerMillionUtf8Bytes("unknown-free-model"), 15);
});
