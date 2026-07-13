import assert from "node:assert/strict";
import test from "node:test";
import { FishAudioTtsService } from "./fish-audio-tts.service.js";

test("Fish Audio TTS posts the complete transcript and streams response chunks", async () => {
  await withFishAudioEnvironment(async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("audio-1"));
            controller.enqueue(Buffer.from("audio-2"));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "audio/mpeg" } },
      );
    }) as typeof fetch;
    const streamed: Buffer[] = [];

    const result = await new FishAudioTtsService().synthesize(
      "[轻声]完整文本",
      (chunk) => streamed.push(chunk),
    );

    assert.equal(requestUrl, "https://fish.test/v1/tts");
    assert.equal(requestInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      text: "[轻声]完整文本",
      format: "mp3",
      latency: "balanced",
      chunk_length: 100,
      reference_id: "reference_1",
    });
    assert.equal(Buffer.concat(streamed).toString(), "audio-1audio-2");
    assert.equal(result.audio.toString(), "audio-1audio-2");
  });
});

test("Fish Audio TTS reports non-success responses", async () => {
  await withFishAudioEnvironment(async () => {
    globalThis.fetch = (async () =>
      new Response('{"message":"invalid reference"}', {
        status: 422,
        statusText: "Unprocessable Content",
      })) as typeof fetch;

    await assert.rejects(
      new FishAudioTtsService().synthesize("完整文本", () => undefined),
      /Fish Audio TTS failed \(422 Unprocessable Content\).*invalid reference/,
    );
  });
});

test("Fish Audio TTS propagates interrupted audio responses", async () => {
  await withFishAudioEnvironment(async () => {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("partial"));
            controller.error(new Error("connection interrupted"));
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await assert.rejects(
      new FishAudioTtsService().synthesize("完整文本", () => undefined),
      /connection interrupted/,
    );
  });
});

async function withFishAudioEnvironment(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const original = {
    apiKey: process.env.FISH_AUDIO_API_KEY,
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID,
    model: process.env.FISH_AUDIO_MODEL,
    url: process.env.FISH_AUDIO_TTS_URL,
    latency: process.env.FISH_AUDIO_LATENCY,
    chunkLength: process.env.FISH_AUDIO_CHUNK_LENGTH,
  };
  process.env.FISH_AUDIO_API_KEY = "test-key";
  process.env.FISH_AUDIO_REFERENCE_ID = "reference_1";
  process.env.FISH_AUDIO_MODEL = "test-model";
  process.env.FISH_AUDIO_TTS_URL = "https://fish.test/v1/tts";
  process.env.FISH_AUDIO_LATENCY = "balanced";
  process.env.FISH_AUDIO_CHUNK_LENGTH = "100";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("FISH_AUDIO_API_KEY", original.apiKey);
    restoreEnvironment("FISH_AUDIO_REFERENCE_ID", original.referenceId);
    restoreEnvironment("FISH_AUDIO_MODEL", original.model);
    restoreEnvironment("FISH_AUDIO_TTS_URL", original.url);
    restoreEnvironment("FISH_AUDIO_LATENCY", original.latency);
    restoreEnvironment("FISH_AUDIO_CHUNK_LENGTH", original.chunkLength);
  }
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
