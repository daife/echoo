import { describe, expect, it } from "vitest";
import {
  createPcmCaptureWorkletSource,
  encodeMp3,
} from "./mp3Recorder";

describe("MP3 recorder", () => {
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
    const registerProcessor = (
      name: string,
      constructor: typeof Processor,
    ) => {
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
        [
          new Float32Array([0, 0.25, -0.5]),
          new Float32Array([0.5, 0.75, 0.5]),
        ],
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
