import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { decode, encode } from "@msgpack/msgpack";
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

    const result = await new FishAudioTtsService(fishConfig()).synthesize(
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
      new FishAudioTtsService(fishConfig()).synthesize(
        "完整文本",
        () => undefined,
      ),
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
      new FishAudioTtsService(fishConfig()).synthesize(
        "完整文本",
        () => undefined,
      ),
      /connection interrupted/,
    );
  });
});

test("Fish Audio streaming TTS sends MessagePack start, text, flush, and stop events", async () => {
  await withFishAudioEnvironment(async () => {
    const sent: Array<Record<string, unknown>> = [];
    let socketUrl = "";
    let socketHeaders: Record<string, unknown> | undefined;
    const socket = new MockWebSocket((data) => {
      const event = decode(data) as Record<string, unknown>;
      sent.push(event);
      if (event.event !== "stop") return;
      queueMicrotask(() => {
        socket.emit(
          "message",
          Buffer.from(encode({ event: "audio", audio: Buffer.from("voice") })),
        );
        socket.emit(
          "message",
          Buffer.from(encode({ event: "finish", reason: "stop" })),
        );
      });
    });
    const service = new FishAudioTtsService(fishConfig(), (url, options) => {
      socketUrl = url;
      socketHeaders = options.headers as Record<string, unknown>;
      queueMicrotask(() => socket.open());
      return socket as never;
    });
    const chunks: Buffer[] = [];

    const stream = service.createStream((chunk) => chunks.push(chunk));
    stream.write("你好。");
    const result = await stream.finish();

    assert.equal(socketUrl, "wss://fish.test/v1/tts/live");
    assert.equal(socketHeaders?.Authorization, "Bearer test-key");
    assert.equal(socketHeaders?.model, "test-model");
    assert.deepEqual(
      sent.map((event) => event.event),
      ["start", "text", "flush", "stop"],
    );
    assert.deepEqual(sent[0]?.request, {
      text: "",
      format: "mp3",
      latency: "balanced",
      chunk_length: 100,
      reference_id: "reference_1",
    });
    assert.equal(sent[1]?.text, "你好。");
    assert.equal(Buffer.concat(chunks).toString(), "voice");
    assert.equal(result.audio.toString(), "voice");
  });
});

function fishConfig() {
  return {
    provider: "fish-audio",
    apiKey: process.env.FISH_AUDIO_API_KEY ?? "",
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID ?? "",
    model: process.env.FISH_AUDIO_MODEL ?? "",
    httpUrl: process.env.FISH_AUDIO_TTS_URL ?? "",
    wsUrl: process.env.FISH_AUDIO_WS_URL ?? "",
    latency: process.env.FISH_AUDIO_LATENCY ?? "balanced",
    chunkLength: Number(process.env.FISH_AUDIO_CHUNK_LENGTH ?? 100),
  };
}

async function withFishAudioEnvironment(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const original = {
    apiKey: process.env.FISH_AUDIO_API_KEY,
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID,
    model: process.env.FISH_AUDIO_MODEL,
    url: process.env.FISH_AUDIO_TTS_URL,
    wsUrl: process.env.FISH_AUDIO_WS_URL,
    latency: process.env.FISH_AUDIO_LATENCY,
    chunkLength: process.env.FISH_AUDIO_CHUNK_LENGTH,
  };
  process.env.FISH_AUDIO_API_KEY = "test-key";
  process.env.FISH_AUDIO_REFERENCE_ID = "reference_1";
  process.env.FISH_AUDIO_MODEL = "test-model";
  process.env.FISH_AUDIO_TTS_URL = "https://fish.test/v1/tts";
  process.env.FISH_AUDIO_WS_URL = "wss://fish.test/v1/tts/live";
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
    restoreEnvironment("FISH_AUDIO_WS_URL", original.wsUrl);
    restoreEnvironment("FISH_AUDIO_LATENCY", original.latency);
    restoreEnvironment("FISH_AUDIO_CHUNK_LENGTH", original.chunkLength);
  }
}

class MockWebSocket extends EventEmitter {
  readyState = 0;
  binaryType = "nodebuffer";

  constructor(private readonly onSend: (data: Uint8Array) => void) {
    super();
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(data: unknown) {
    this.onSend(data as Uint8Array);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
