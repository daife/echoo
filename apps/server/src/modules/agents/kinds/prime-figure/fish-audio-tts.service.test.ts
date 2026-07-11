import assert from "node:assert/strict";
import test from "node:test";
import { decode, encode } from "@msgpack/msgpack";
import { WebSocketServer } from "ws";
import { FishAudioTtsService } from "../../../tts/fish-audio-tts.service.js";

test("Fish Audio client streams MessagePack text and receives audio before stop", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = typeof address === "object" && address ? address.port : 0;
  const received: Array<Record<string, unknown>> = [];
  let audioArrivedBeforeStop = false;

  server.on("connection", (socket, request) => {
    assert.equal(request.headers.authorization, "Bearer test-fish-key");
    assert.equal(request.headers.model, "s2.1-pro-free");
    socket.on("message", (raw) => {
      const event = decode(new Uint8Array(raw as Buffer)) as Record<
        string,
        unknown
      >;
      received.push(event);
      if (event.event === "text" && !audioArrivedBeforeStop) {
        audioArrivedBeforeStop = true;
        socket.send(
          encode({ event: "audio", audio: new Uint8Array([1, 2, 3]) }),
        );
      }
      if (event.event === "stop")
        socket.send(encode({ event: "finish", reason: "stop" }));
    });
  });

  process.env.FISH_AUDIO_API_KEY = "test-fish-key";
  process.env.FISH_AUDIO_REFERENCE_ID = "voice-model-id";
  process.env.FISH_AUDIO_WS_URL = `ws://127.0.0.1:${port}`;
  process.env.FISH_AUDIO_MODEL = "s2.1-pro-free";
  try {
    const chunks: Buffer[] = [];
    const stream = new FishAudioTtsService().createStream((chunk) =>
      chunks.push(chunk),
    );
    stream.write("你好[soft]");
    stream.write("，这是实时语音。[chuckling]");
    const result = await stream.finish();

    assert.equal(audioArrivedBeforeStop, true);
    assert.deepEqual(result.audio, Buffer.from([1, 2, 3]));
    assert.deepEqual(chunks, [Buffer.from([1, 2, 3])]);
    assert.deepEqual(
      received.map((event) => event.event),
      ["start", "text", "text", "flush", "stop"],
    );
    const start = received[0]?.request as Record<string, unknown>;
    assert.equal(start.reference_id, "voice-model-id");
    assert.equal(start.chunk_length, 100);
    assert.equal(start.latency, "balanced");
    assert.equal(received[1]?.text, "你好[soft]");
    assert.equal(received[2]?.text, "，这是实时语音。[chuckling]");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.FISH_AUDIO_API_KEY;
    delete process.env.FISH_AUDIO_REFERENCE_ID;
    delete process.env.FISH_AUDIO_WS_URL;
    delete process.env.FISH_AUDIO_MODEL;
  }
});
