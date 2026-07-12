interface AudioStreamState {
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer?: SourceBuffer;
  queue: Uint8Array[];
  completed: boolean;
  objectUrl: string;
  playable: boolean;
}

export interface StreamingAudioState {
  available: boolean;
  playable: boolean;
  playing: boolean;
  completed: boolean;
}

export class StreamingAudioPlayer {
  private readonly streams = new Map<string, AudioStreamState>();
  private readonly listeners = new Set<() => void>();

  start(messageId: string, mimeType: string) {
    this.stop(messageId);
    if (!("MediaSource" in window) || !MediaSource.isTypeSupported(mimeType))
      return;
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const audio = new Audio(objectUrl);
    const state: AudioStreamState = {
      audio,
      mediaSource,
      queue: [],
      completed: false,
      objectUrl,
      playable: false,
    };
    this.streams.set(messageId, state);
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (this.streams.get(messageId) !== state) return;
        state.sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        state.sourceBuffer.addEventListener("updateend", () =>
          this.drain(messageId, state),
        );
        this.drain(messageId, state);
      },
      { once: true },
    );
    audio.addEventListener("play", () => this.notify());
    audio.addEventListener("pause", () => this.notify());
    this.notify();
  }

  append(messageId: string, dataBase64: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    state.queue.push(bytes);
    state.playable = true;
    this.notify();
    this.drain(messageId, state);
  }

  complete(messageId: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    state.completed = true;
    this.notify();
    this.drain(messageId, state);
  }

  stop(messageId: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    state.audio.pause();
    URL.revokeObjectURL(state.objectUrl);
    this.streams.delete(messageId);
    this.notify();
  }

  stopAll() {
    for (const id of [...this.streams.keys()]) this.stop(id);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(messageId: string): StreamingAudioState {
    const state = this.streams.get(messageId);
    return state
      ? {
          available: true,
          playable: state.playable,
          playing: !state.audio.paused,
          completed: state.completed,
        }
      : { available: false, playable: false, playing: false, completed: false };
  }

  toggle(messageId: string) {
    const state = this.streams.get(messageId);
    if (!state?.playable) return;
    if (state.audio.paused) void state.audio.play().catch(() => undefined);
    else state.audio.pause();
  }

  private drain(messageId: string, state: AudioStreamState) {
    if (this.streams.get(messageId) !== state) return;
    const sourceBuffer = state.sourceBuffer;
    if (
      !sourceBuffer ||
      sourceBuffer.updating ||
      state.mediaSource.readyState !== "open"
    )
      return;
    const next = state.queue.shift();
    if (next) {
      const copy = new Uint8Array(next.byteLength);
      copy.set(next);
      sourceBuffer.appendBuffer(copy.buffer);
      return;
    }
    if (state.completed) {
      state.mediaSource.endOfStream();
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export const streamingAudioPlayer = new StreamingAudioPlayer();
