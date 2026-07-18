import assert from "node:assert/strict";
import test from "node:test";
import { decode } from "@msgpack/msgpack";
import {
  FISH_AUDIO_ASR_MODEL,
  FishAudioSttService,
  fishAudioAsrCostUsd,
} from "./fish-audio-stt.service.js";

test("Fish Audio STT pricing rounds audio up to the next second", () => {
  assert.equal(fishAudioAsrCostUsd(0), 0);
  assert.equal(fishAudioAsrCostUsd(0.1), 0.36 / 3_600);
  assert.equal(fishAudioAsrCostUsd(1.1), (2 * 0.36) / 3_600);
});

test("Fish Audio STT sends MessagePack and bills platform audio duration", async () => {
  let assertedBalance = 0;
  const charges: Array<Record<string, unknown>> = [];
  let requestPayload: Record<string, unknown> | undefined;
  const service = new FishAudioSttService(
    {
      readForOwner: async () => ({ data: Buffer.from([1, 2, 3]) }),
    } as never,
    (async (url, init) => {
      assert.equal(url, "https://api.fish.audio/v1/asr");
      assert.equal(init?.method, "POST");
      assert.deepEqual(init?.headers, {
        Authorization: "Bearer platform-key",
        "Content-Type": "application/msgpack",
      });
      requestPayload = decode(init?.body as Buffer) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ text: "  测试转录  ", duration: 10, segments: [] }),
        {
          status: 200,
          headers: { "x-request-id": "upstream-asr-id" },
        },
      );
    }) as typeof fetch,
    {
      assertPlatformBalance: async () => {
        assertedBalance += 1;
      },
      chargeUsage: async (input: Record<string, unknown>) => {
        charges.push(input);
      },
    } as never,
  );

  const annotations = await service.annotate(
    "owner-1",
    [
      {
        id: "media_1",
        messageId: "message-1",
        type: "voice",
        resourceId: "r1",
      },
    ],
    {
      source: "platform",
      apiKey: "platform-key",
      httpUrl: "https://api.fish.audio/v1/asr",
      language: "zh",
    },
  );

  assert.equal(assertedBalance, 1);
  assert.deepEqual(requestPayload, {
    audio: Buffer.from([1, 2, 3]),
    ignore_timestamps: true,
    language: "zh",
  });
  assert.deepEqual(annotations, [
    { id: "media_1", type: "voice", transcript: "测试转录" },
  ]);
  assert.equal(charges.length, 1);
  assert.equal(charges[0]?.service, "fish_audio");
  assert.equal(charges[0]?.model, FISH_AUDIO_ASR_MODEL);
  assert.equal(charges[0]?.upstreamRequestId, "upstream-asr-id");
  assert.equal(charges[0]?.upstreamCostUsd, (10 / 3_600) * 0.36);
});

test("custom Fish Audio STT omits language and does not use platform billing", async () => {
  let requestPayload: Record<string, unknown> | undefined;
  const service = new FishAudioSttService(
    {
      readForOwner: async () => ({ data: Buffer.from([4, 5]) }),
    } as never,
    (async (_url, init) => {
      requestPayload = decode(init?.body as Buffer) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ text: "hello", duration: 1, segments: [] }),
      );
    }) as typeof fetch,
    {
      assertPlatformBalance: async () =>
        assert.fail("must not assert platform balance"),
      chargeUsage: async () => assert.fail("must not charge platform balance"),
    } as never,
  );

  await service.annotate(
    "owner-1",
    [
      {
        id: "media_1",
        messageId: "message-1",
        type: "voice",
        resourceId: "r1",
      },
    ],
    {
      source: "custom",
      apiKey: "custom-key",
      httpUrl: "https://fish.test/v1/asr",
      language: "",
    },
  );

  assert.equal(requestPayload?.language, undefined);
  assert.equal(requestPayload?.ignore_timestamps, true);
});

test("Fish Audio STT rejects an empty transcript", async () => {
  const service = new FishAudioSttService(
    {
      readForOwner: async () => ({ data: Buffer.from([1]) }),
    } as never,
    (async () =>
      new Response(
        JSON.stringify({ text: " ", duration: 1, segments: [] }),
      )) as typeof fetch,
    {} as never,
  );

  await assert.rejects(
    service.annotate(
      "owner-1",
      [
        {
          id: "media_1",
          messageId: "message-1",
          type: "voice",
          resourceId: "r1",
        },
      ],
      {
        source: "custom",
        apiKey: "custom-key",
        httpUrl: "https://fish.test/v1/asr",
        language: "",
      },
    ),
    /empty transcript/,
  );
});
