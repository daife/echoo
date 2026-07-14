import { estimateMp3DurationSeconds } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import { encodeMp3 } from "./mp3Recorder";

describe("MP3 recorder encoding", () => {
  it("encodes mono PCM into a valid one-second MP3", async () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from(
      { length: sampleRate },
      (_, index) => Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0.2,
    );

    const blob = await encodeMp3([samples], sampleRate);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(4_000);
    expect(estimateMp3DurationSeconds(bytes)).toBeGreaterThanOrEqual(1);
    expect(estimateMp3DurationSeconds(bytes)).toBeLessThan(1.1);
  });
});
