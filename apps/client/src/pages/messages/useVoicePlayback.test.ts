import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePlaybackController } from "./useVoicePlayback";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  preload = "";
  paused = true;
  currentTime = 0;
  rejectNextPlay = false;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeAudio.instances.push(this);
  }

  async play() {
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      throw new Error("autoplay blocked");
    }
    this.paused = false;
    this.onplay?.();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.onpause?.();
  }

  finish() {
    this.paused = true;
    this.onended?.();
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  load() {}

  addEventListener(type: string, listener: () => void) {
    if (type === "loadedmetadata") queueMicrotask(listener);
  }
}

const started = (messageId: string) => ({
  type: "message.audio.started" as const,
  messageId,
  conversationId: "conversation_1",
  mimeType: "audio/mpeg",
});

const chunk = (messageId: string, sequence: number) => ({
  type: "message.audio.chunk" as const,
  messageId,
  conversationId: "conversation_1",
  sequence,
  data: new Uint8Array([sequence + 1]),
});

const completed = (messageId: string) => ({
  type: "message.audio.completed" as const,
  messageId,
  conversationId: "conversation_1",
  mediaUrl: `/api/resources/${messageId}/file`,
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("VoicePlaybackController", () => {
  let createObjectUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaSource", undefined);
    let objectUrl = 0;
    createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:test-${objectUrl++}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts playing from the first contiguous chunk before completion", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    controller.setAutoPlay(true);
    controller.handleStarted(started("voice_1"));
    controller.handleChunk(chunk("voice_1", 1));
    expect(FakeAudio.instances[0]?.paused).toBe(true);
    controller.handleChunk(chunk("voice_1", 0));
    await flush();
    expect(FakeAudio.instances[0]?.paused).toBe(false);
    expect(controller.snapshot().currentMessageId).toBe("voice_1");
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    controller.handleChunk(chunk("voice_1", 1));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("plays automatic tracks serially", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    controller.setAutoPlay(true);
    controller.handleStarted(started("voice_1"));
    controller.handleChunk(chunk("voice_1", 0));
    controller.handleStarted(started("voice_2"));
    controller.handleChunk(chunk("voice_2", 0));
    controller.handleCompleted(completed("voice_1"));
    controller.handleCompleted(completed("voice_2"));
    await flush();
    expect(controller.snapshot().currentMessageId).toBe("voice_1");
    FakeAudio.instances[0]?.finish();
    await flush();
    expect(controller.snapshot().currentMessageId).toBe("voice_2");
    expect(FakeAudio.instances[1]?.paused).toBe(false);
  });

  it("interrupts with a manually selected track and then resumes the prior one", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    controller.setAutoPlay(true);
    controller.handleStarted(started("voice_1"));
    controller.handleChunk(chunk("voice_1", 0));
    controller.handleStarted(started("voice_2"));
    controller.handleChunk(chunk("voice_2", 0));
    controller.handleCompleted(completed("voice_1"));
    controller.handleCompleted(completed("voice_2"));
    await controller.toggle("voice_2");
    expect(controller.snapshot().currentMessageId).toBe("voice_2");
    expect(FakeAudio.instances[0]?.paused).toBe(true);
    FakeAudio.instances[1]?.finish();
    await flush();
    expect(controller.snapshot().currentMessageId).toBe("voice_1");
    expect(FakeAudio.instances[0]?.paused).toBe(false);
  });

  it("retains a blocked automatic item for a user click", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    controller.setAutoPlay(true);
    controller.handleStarted(started("voice_1"));
    FakeAudio.instances[0]!.rejectNextPlay = true;
    controller.handleChunk(chunk("voice_1", 0));
    await flush();
    expect(controller.snapshot().blocked).toBe(true);
    await controller.toggle("voice_1");
    expect(controller.snapshot()).toMatchObject({
      currentMessageId: "voice_1",
      isPlaying: true,
      blocked: false,
    });
  });

  it("plays and completes a historical media URL without a realtime stream", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    await controller.toggle("voice_history", "https://cdn.test/voice.mp3");
    expect(FakeAudio.instances[0]?.src).toBe("https://cdn.test/voice.mp3");
    expect(controller.snapshot().isPlaying).toBe(true);
    FakeAudio.instances[0]?.finish();
    expect(controller.snapshot().currentMessageId).toBeUndefined();
  });

  it("skips failed tracks and clears resources on reset", async () => {
    const controller = new VoicePlaybackController(() => undefined);
    controller.setAutoPlay(true);
    controller.handleStarted(started("voice_1"));
    controller.handleStarted(started("voice_2"));
    controller.handleChunk(chunk("voice_2", 0));
    controller.handleFailed({
      type: "message.audio.failed",
      messageId: "voice_1",
      conversationId: "conversation_1",
      error: "failed",
    });
    await flush();
    expect(controller.snapshot().currentMessageId).toBe("voice_2");
    controller.reset();
    expect(controller.snapshot().currentMessageId).toBeUndefined();
    expect(FakeAudio.instances.every((audio) => audio.paused)).toBe(true);
  });
});
