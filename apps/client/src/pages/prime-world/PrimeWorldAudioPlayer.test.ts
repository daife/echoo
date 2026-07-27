import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimeWorldAudioPlayer } from "./PrimeWorldAudioPlayer";

class FakeAudio {
  src = "";
  paused = true;

  constructor(src?: string) {
    if (src) this.src = src;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute() {
    this.src = "";
  }

  load() {}
}

describe("PrimeWorldAudioPlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaSource", undefined);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:world-audio"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a complete contiguous stream for persistence", async () => {
    const player = new PrimeWorldAudioPlayer();
    player.start("audio/mpeg");
    player.append(0, new Uint8Array([1, 2]));
    player.append(1, new Uint8Array([3]));

    const blob = await player.complete();

    expect(await blob?.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it("does not return an incomplete stream", async () => {
    const player = new PrimeWorldAudioPlayer();
    player.start("audio/mpeg");
    player.append(1, new Uint8Array([2]));

    expect(await player.complete()).toBeUndefined();
  });
});
