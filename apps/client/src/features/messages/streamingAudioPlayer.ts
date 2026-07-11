interface AudioStreamState {
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer?: SourceBuffer;
  queue: Uint8Array[];
  completed: boolean;
  objectUrl: string;
}

export class StreamingAudioPlayer {
  private readonly streams = new Map<string, AudioStreamState>();

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
        void audio.play().catch(() => undefined);
      },
      { once: true },
    );
  }

  append(messageId: string, dataBase64: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    state.queue.push(bytes);
    this.drain(messageId, state);
  }

  complete(messageId: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    state.completed = true;
    this.drain(messageId, state);
  }

  stop(messageId: string) {
    const state = this.streams.get(messageId);
    if (!state) return;
    state.audio.pause();
    URL.revokeObjectURL(state.objectUrl);
    this.streams.delete(messageId);
  }

  stopAll() {
    for (const id of [...this.streams.keys()]) this.stop(id);
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
      void state.audio.play().catch(() => undefined);
      return;
    }
    if (state.completed) {
      state.mediaSource.endOfStream();
      const cleanup = () => this.stop(messageId);
      state.audio.addEventListener("ended", cleanup, { once: true });
    }
  }
}
