import assert from "node:assert/strict";
import test from "node:test";
import { FishAudioVoiceCloneService } from "./fish-audio-voice-clone.service.js";

test("Fish voice cloning sends a private fast multipart model request", async () => {
  const previousFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ _id: "voice_ref", state: "trained" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await new FishAudioVoiceCloneService("test-key").create({
      name: "旁白",
      description: "自然",
      audio: new Uint8Array([0xff, 0xfb, 0x90, 0]),
    });
    assert.deepEqual(result, { referenceId: "voice_ref", state: "trained" });
    assert.equal(captured?.method, "POST");
    const form = captured?.body as FormData;
    assert.equal(form.get("type"), "tts");
    assert.equal(form.get("train_mode"), "fast");
    assert.equal(form.get("visibility"), "private");
    assert.equal(form.get("enhance_audio_quality"), "true");
    assert.ok(form.get("voices") instanceof Blob);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
