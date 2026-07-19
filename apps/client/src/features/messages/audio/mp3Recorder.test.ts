import { describe, expect, it } from "vitest";
import {
  createPcmCaptureWorkletSource,
  encodeMp3,
  getMicrophoneUnavailableMessage,
} from "./mp3Recorder";
import { describeMicrophoneError } from "../usePushToTalk";

describe("MP3 recorder", () => {
  it("explains that an insecure page must use trusted HTTPS", () => {
    expect(
      getMicrophoneUnavailableMessage({
        isSecureContext: false,
        hasGetUserMedia: false,
        hasAudioContext: true,
      }),
    ).toContain("HTTPS");
  });

  it("distinguishes a missing media API from a missing audio context", () => {
    expect(
      getMicrophoneUnavailableMessage({
        isSecureContext: true,
        hasGetUserMedia: false,
        hasAudioContext: true,
      }),
    ).toContain("麦克风录音接口");
    expect(
      getMicrophoneUnavailableMessage({
        isSecureContext: true,
        hasGetUserMedia: true,
        hasAudioContext: false,
      }),
    ).toContain("音频采集");
  });

  it("accepts a secure browser with media and audio APIs", () => {
    expect(
      getMicrophoneUnavailableMessage({
        isSecureContext: true,
        hasGetUserMedia: true,
        hasAudioContext: true,
      }),
    ).toBeNull();
  });

  it("maps permission, device, and busy microphone failures separately", () => {
    expect(
      describeMicrophoneError(new DOMException("denied", "NotAllowedError")),
    ).toContain("允许浏览器");
    expect(
      describeMicrophoneError(new DOMException("missing", "NotFoundError")),
    ).toContain("未找到");
    expect(
      describeMicrophoneError(new DOMException("busy", "NotReadableError")),
    ).toContain("占用");
  });

  it("downmixes every microphone input channel in the audio worklet", () => {
    let Processor:
      | (new () => {
          port: { postMessage: (value: Float32Array) => void };
          process: (inputs: Float32Array[][]) => boolean;
        })
      | undefined;
    const posted: Float32Array[] = [];
    class FakeAudioWorkletProcessor {
      port = {
        postMessage: (value: Float32Array) => posted.push(value),
      };
    }
    const registerProcessor = (name: string, constructor: typeof Processor) => {
      expect(name).toBe("echoo-pcm-capture");
      Processor = constructor;
    };

    new Function(
      "AudioWorkletProcessor",
      "registerProcessor",
      createPcmCaptureWorkletSource(),
    )(FakeAudioWorkletProcessor, registerProcessor);

    expect(Processor).toBeDefined();
    const processor = new Processor!();
    expect(
      processor.process([
        [new Float32Array([0, 0.25, -0.5]), new Float32Array([0.5, 0.75, 0.5])],
      ]),
    ).toBe(true);
    expect(Array.from(posted[0] ?? [])).toEqual([0.25, 0.5, 0]);
  });

  it("encodes captured PCM as a non-empty MPEG audio blob", async () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from(
      { length: sampleRate },
      (_, index) => Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.5,
    );

    const blob = await encodeMp3([samples], sampleRate);

    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(7_000);
    const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect(header[0]).toBe(0xff);
    expect(header[1]! & 0xe0).toBe(0xe0);
  });
});
