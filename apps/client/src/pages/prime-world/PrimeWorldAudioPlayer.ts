export class PrimeWorldAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly queue: ArrayBuffer[] = [];
  private readonly fallback: ArrayBuffer[] = [];
  private expectedSequence = 0;
  private missingChunk = false;
  private objectUrl?: string;
  private mimeType = "audio/mpeg";

  start(mimeType = "audio/mpeg") {
    this.stop();
    this.expectedSequence = 0;
    this.missingChunk = false;
    this.mimeType = mimeType;
    this.audio = new Audio();
    if (
      typeof MediaSource === "undefined" ||
      !MediaSource.isTypeSupported(mimeType)
    )
      return;
    const mediaSource = new MediaSource();
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    this.audio.src = this.objectUrl;
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (this.mediaSource !== mediaSource) return;
        try {
          this.sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          this.sourceBuffer.mode = "sequence";
          this.sourceBuffer.addEventListener("updateend", () => this.flush());
          this.flush();
          void this.audio?.play().catch(() => undefined);
        } catch {
          this.sourceBuffer = null;
        }
      },
      { once: true },
    );
  }

  append(sequence: number, data: Uint8Array) {
    if (sequence !== this.expectedSequence) this.missingChunk = true;
    this.expectedSequence = Math.max(this.expectedSequence, sequence + 1);
    const copy = Uint8Array.from(data).buffer;
    this.fallback.push(copy);
    if (!this.missingChunk) this.queue.push(copy);
    this.flush();
  }

  async complete(fallbackUrl?: string): Promise<Blob | undefined> {
    if (this.missingChunk && fallbackUrl) {
      this.stop();
      if (fallbackUrl.startsWith("blob:")) this.objectUrl = fallbackUrl;
      this.audio = new Audio(fallbackUrl);
      await this.audio.play().catch(() => undefined);
      return;
    }
    const completedBlob = !this.missingChunk && this.fallback.length
      ? new Blob(this.fallback, { type: this.mimeType })
      : undefined;
    if (this.mediaSource && this.sourceBuffer) {
      const finish = () => {
        if (this.queue.length || this.sourceBuffer?.updating) return;
        if (this.mediaSource?.readyState === "open")
          this.mediaSource.endOfStream();
      };
      this.sourceBuffer.addEventListener("updateend", finish, { once: true });
      finish();
      return completedBlob;
    }
    if (!completedBlob) return;
    this.objectUrl = URL.createObjectURL(completedBlob);
    this.audio ??= new Audio();
    this.audio.src = this.objectUrl;
    await this.audio.play().catch(() => undefined);
    return completedBlob;
  }

  requiresFullResource() {
    return this.missingChunk;
  }

  stop() {
    this.audio?.pause();
    this.audio?.removeAttribute("src");
    this.audio?.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.audio = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.objectUrl = undefined;
    this.queue.length = 0;
    this.fallback.length = 0;
  }

  private flush() {
    if (
      !this.sourceBuffer ||
      this.sourceBuffer.updating ||
      !this.queue.length ||
      this.missingChunk
    )
      return;
    const next = this.queue.shift()!;
    try {
      this.sourceBuffer.appendBuffer(next);
    } catch {
      this.missingChunk = true;
    }
  }
}
