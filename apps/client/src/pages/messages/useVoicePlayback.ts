import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MessageAudioChunkEvent,
  MessageAudioCompletedEvent,
  MessageAudioFailedEvent,
  MessageAudioStartedEvent,
} from "../../runtimes/contracts";
import { mediaCache, resolveMediaUrl } from "../../services/mediaCache";

export interface VoicePlaybackSnapshot {
  currentMessageId?: string;
  isPlaying: boolean;
  blocked: boolean;
}

interface VoiceTrack {
  id: string;
  mimeType: string;
  audio: HTMLAudioElement;
  mediaSource?: MediaSource;
  sourceBuffer?: SourceBuffer;
  objectUrl?: string;
  chunks: Map<number, Uint8Array>;
  orderedChunks: Uint8Array[];
  nextSequence: number;
  appendedChunks: number;
  complete: boolean;
  failed: boolean;
  mediaUrl?: string;
  waitingToPlay: boolean;
  fallbackRenderedChunks: number;
}

export class VoicePlaybackController {
  private tracks = new Map<string, VoiceTrack>();
  private queue: string[] = [];
  private currentMessageId?: string;
  private autoPlay = false;
  private blocked = false;

  constructor(
    private readonly onChange: (snapshot: VoicePlaybackSnapshot) => void,
    private readonly loadCachedBlob: (
      mediaUrl: string,
    ) => Promise<Blob | null> = (mediaUrl) =>
      mediaCache.get(mediaUrl, "original"),
  ) {}

  setAutoPlay(enabled: boolean) {
    const wasEnabled = this.autoPlay;
    this.autoPlay = enabled;
    if (!wasEnabled && enabled)
      for (const track of this.tracks.values())
        if (!track.failed) this.enqueue(track.id);
  }

  handleStarted(event: MessageAudioStartedEvent) {
    if (this.tracks.has(event.messageId)) return;
    const track = this.createTrack(event.messageId, event.mimeType);
    this.tracks.set(event.messageId, track);
    if (this.autoPlay) this.enqueue(event.messageId);
  }

  handleChunk(event: MessageAudioChunkEvent) {
    const track =
      this.tracks.get(event.messageId) ??
      this.createAndStoreTrack(event.messageId, "audio/mpeg");
    if (track.failed || event.sequence < track.nextSequence) return;
    if (!track.chunks.has(event.sequence))
      track.chunks.set(event.sequence, event.data);
    while (track.chunks.has(track.nextSequence)) {
      const chunk = track.chunks.get(track.nextSequence)!;
      track.chunks.delete(track.nextSequence);
      track.orderedChunks.push(chunk);
      track.nextSequence += 1;
    }
    this.pump(track);
  }

  handleCompleted(event: MessageAudioCompletedEvent) {
    const track = this.tracks.get(event.messageId);
    if (!track) return;
    track.complete = true;
    track.mediaUrl = event.mediaUrl;
    if (
      event.mediaUrl &&
      this.currentMessageId !== track.id &&
      !this.queue.includes(track.id)
    ) {
      this.releaseStreamingSource(track);
      track.chunks.clear();
      track.orderedChunks = [];
      track.appendedChunks = 0;
      track.fallbackRenderedChunks = 0;
      return;
    }
    if (!track.orderedChunks.length && event.mediaUrl) {
      this.releaseStreamingSource(track);
      void this.prepareCompleteSource(track).then(() => {
        if (this.currentMessageId === track.id) return this.play(track, false);
      });
      return;
    }
    this.pump(track);
  }

  handleFailed(event: MessageAudioFailedEvent) {
    const track = this.tracks.get(event.messageId);
    if (track) track.failed = true;
    this.queue = this.queue.filter((id) => id !== event.messageId);
    if (this.currentMessageId === event.messageId) this.finishCurrent();
    else this.emit();
  }

  async toggle(messageId: string, mediaUrl?: string) {
    if (this.currentMessageId === messageId) {
      const track = this.tracks.get(messageId);
      if (!track) return;
      if (track.audio.paused) await this.play(track, true);
      else track.audio.pause();
      return;
    }

    const interruptedId = this.currentMessageId;
    if (interruptedId) {
      const interrupted = this.tracks.get(interruptedId);
      interrupted?.audio.pause();
      if (interrupted && !interrupted.failed)
        this.queue = [
          interruptedId,
          ...this.queue.filter((id) => id !== interruptedId),
        ];
    }

    this.queue = this.queue.filter((id) => id !== messageId);
    const track =
      this.tracks.get(messageId) ??
      this.createAndStoreTrack(messageId, "audio/mpeg", false);
    if (mediaUrl) {
      track.mediaUrl = mediaUrl;
      track.complete = true;
    }
    this.currentMessageId = messageId;
    this.blocked = false;
    this.emit();
    await this.prepareCompleteSource(track);
    if (this.currentMessageId !== messageId) return;
    await this.play(track, true);
  }

  reset() {
    for (const track of this.tracks.values()) this.disposeTrack(track);
    this.tracks.clear();
    this.queue = [];
    this.currentMessageId = undefined;
    this.blocked = false;
    this.emit();
  }

  snapshot(): VoicePlaybackSnapshot {
    const current = this.currentMessageId
      ? this.tracks.get(this.currentMessageId)
      : undefined;
    return {
      currentMessageId: this.currentMessageId,
      isPlaying: Boolean(current && !current.audio.paused),
      blocked: this.blocked,
    };
  }

  private createAndStoreTrack(id: string, mimeType: string, streaming = true) {
    const track = this.createTrack(id, mimeType, streaming);
    this.tracks.set(id, track);
    return track;
  }

  private createTrack(
    id: string,
    mimeType: string,
    streaming = true,
  ): VoiceTrack {
    const audio = new Audio();
    audio.preload = "auto";
    const track: VoiceTrack = {
      id,
      mimeType,
      audio,
      chunks: new Map(),
      orderedChunks: [],
      nextSequence: 0,
      appendedChunks: 0,
      complete: false,
      failed: false,
      waitingToPlay: false,
      fallbackRenderedChunks: 0,
    };
    audio.onplay = () => {
      this.blocked = false;
      this.emit();
    };
    audio.onpause = () => this.emit();
    audio.onended = () => {
      if (this.tryRefreshFallback(track)) return;
      if (!track.complete) {
        track.waitingToPlay = true;
        this.emit();
        return;
      }
      if (this.currentMessageId === id) this.finishCurrent();
    };
    audio.onerror = () => {
      if (!track.complete || track.mediaSource) return;
      track.failed = true;
      if (this.currentMessageId === id) this.finishCurrent();
    };

    if (
      typeof MediaSource !== "undefined" &&
      streaming &&
      MediaSource.isTypeSupported(mimeType)
    ) {
      const mediaSource = new MediaSource();
      track.mediaSource = mediaSource;
      track.objectUrl = URL.createObjectURL(mediaSource);
      audio.src = track.objectUrl;
      mediaSource.addEventListener(
        "sourceopen",
        () => {
          if (
            track.failed ||
            track.mediaSource !== mediaSource ||
            mediaSource.readyState !== "open"
          )
            return;
          try {
            const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
            sourceBuffer.mode = "sequence";
            track.sourceBuffer = sourceBuffer;
            sourceBuffer.addEventListener("updateend", () => this.pump(track));
            this.pump(track);
          } catch {
            track.mediaSource = undefined;
            track.sourceBuffer = undefined;
            this.refreshFallbackSource(track);
          }
        },
        { once: true },
      );
    }
    return track;
  }

  private pump(track: VoiceTrack) {
    if (track.failed) return;
    const sourceBuffer = track.sourceBuffer;
    if (sourceBuffer) {
      if (
        !sourceBuffer.updating &&
        track.appendedChunks < track.orderedChunks.length
      ) {
        const chunk = track.orderedChunks[track.appendedChunks]!;
        track.appendedChunks += 1;
        try {
          sourceBuffer.appendBuffer(chunk.slice().buffer);
          track.orderedChunks[track.appendedChunks - 1] = new Uint8Array();
        } catch {
          track.appendedChunks -= 1;
        }
        return;
      }
      if (
        track.complete &&
        !sourceBuffer.updating &&
        track.appendedChunks >= track.orderedChunks.length &&
        track.mediaSource?.readyState === "open"
      ) {
        try {
          track.mediaSource.endOfStream();
        } catch {
          // A concurrent SourceBuffer update will retry through updateend.
        }
      }
    } else if (
      !track.mediaSource &&
      track.fallbackRenderedChunks < track.orderedChunks.length &&
      (!track.audio.src || track.audio.paused || track.waitingToPlay)
    ) {
      this.refreshFallbackSource(track);
    }

    if (track.waitingToPlay && track.orderedChunks.length) {
      track.waitingToPlay = false;
      void this.play(track, false);
    }
  }

  private enqueue(messageId: string) {
    if (this.currentMessageId === messageId || this.queue.includes(messageId))
      return;
    this.queue.push(messageId);
    if (!this.currentMessageId) this.advance();
  }

  private advance() {
    const nextId = this.queue.shift();
    if (!nextId) {
      this.currentMessageId = undefined;
      this.blocked = false;
      this.emit();
      return;
    }
    const track = this.tracks.get(nextId);
    if (!track || track.failed) {
      this.advance();
      return;
    }
    this.currentMessageId = nextId;
    this.blocked = false;
    this.emit();
    void this.prepareCompleteSource(track).then(() => {
      if (this.currentMessageId === nextId) return this.play(track, false);
    });
  }

  private finishCurrent() {
    const finishedId = this.currentMessageId;
    if (finishedId) {
      const track = this.tracks.get(finishedId);
      track?.audio.pause();
      if (track && (track.complete || track.failed)) {
        this.disposeTrack(track);
        this.tracks.delete(finishedId);
      }
    }
    this.currentMessageId = undefined;
    this.blocked = false;
    this.advance();
  }

  private async play(track: VoiceTrack, userInitiated: boolean) {
    if (track.failed || this.currentMessageId !== track.id) return;
    if (!track.audio.src && track.mediaUrl)
      await this.prepareCompleteSource(track);
    if (
      !track.audio.src ||
      (!track.sourceBuffer && !track.complete && !track.orderedChunks.length)
    ) {
      track.waitingToPlay = true;
      this.emit();
      return;
    }
    try {
      await track.audio.play();
    } catch {
      track.waitingToPlay = false;
      this.blocked = !userInitiated;
      this.emit();
    }
  }

  private async prepareCompleteSource(track: VoiceTrack) {
    if (track.audio.src || !track.mediaUrl) return;
    const blob = await this.loadCachedBlob(track.mediaUrl);
    if (track.failed || track.audio.src) return;
    if (blob) {
      track.objectUrl = URL.createObjectURL(blob);
      track.audio.src = track.objectUrl;
      return;
    }
    const directUrl = await mediaCache.getDirectUrl(track.mediaUrl, "original");
    if (track.failed || track.audio.src) return;
    const source = resolveMediaUrl(directUrl);
    if (source) track.audio.src = source;
  }

  private refreshFallbackSource(track: VoiceTrack) {
    if (!track.orderedChunks.length) return;
    const wasPlaying = !track.audio.paused;
    const currentTime = track.audio.currentTime;
    if (track.objectUrl) URL.revokeObjectURL(track.objectUrl);
    track.objectUrl = URL.createObjectURL(
      new Blob(
        track.orderedChunks.map((chunk) => chunk.slice()),
        {
          type: track.mimeType,
        },
      ),
    );
    track.fallbackRenderedChunks = track.orderedChunks.length;
    track.audio.src = track.objectUrl;
    if (currentTime > 0) {
      track.audio.addEventListener(
        "loadedmetadata",
        () => {
          track.audio.currentTime = Math.max(0, currentTime - 0.04);
          if (wasPlaying) void this.play(track, false);
        },
        { once: true },
      );
    }
  }

  private tryRefreshFallback(track: VoiceTrack) {
    if (
      track.mediaSource ||
      track.fallbackRenderedChunks >= track.orderedChunks.length
    )
      return false;
    this.refreshFallbackSource(track);
    void this.play(track, false);
    return true;
  }

  private disposeTrack(track: VoiceTrack) {
    track.failed = true;
    track.audio.pause();
    track.audio.removeAttribute("src");
    track.audio.load();
    if (track.objectUrl) URL.revokeObjectURL(track.objectUrl);
  }

  private releaseStreamingSource(track: VoiceTrack) {
    track.sourceBuffer = undefined;
    track.mediaSource = undefined;
    track.audio.pause();
    track.audio.removeAttribute("src");
    track.audio.load();
    if (track.objectUrl) URL.revokeObjectURL(track.objectUrl);
    track.objectUrl = undefined;
  }

  private emit() {
    this.onChange(this.snapshot());
  }
}

export function useVoicePlayback(input: {
  conversationId?: string;
  autoPlay: boolean;
}) {
  const [snapshot, setSnapshot] = useState<VoicePlaybackSnapshot>({
    isPlaying: false,
    blocked: false,
  });
  const controllerRef = useRef<VoicePlaybackController | null>(null);
  if (!controllerRef.current)
    controllerRef.current = new VoicePlaybackController(setSnapshot);
  const controller = controllerRef.current;

  useEffect(
    () => controller.setAutoPlay(input.autoPlay),
    [controller, input.autoPlay],
  );
  useEffect(() => {
    controller.reset();
    return () => controller.reset();
  }, [controller, input.conversationId]);

  return {
    snapshot,
    handleStarted: useCallback(
      (event: MessageAudioStartedEvent) => controller.handleStarted(event),
      [controller],
    ),
    handleChunk: useCallback(
      (event: MessageAudioChunkEvent) => controller.handleChunk(event),
      [controller],
    ),
    handleCompleted: useCallback(
      (event: MessageAudioCompletedEvent) => controller.handleCompleted(event),
      [controller],
    ),
    handleFailed: useCallback(
      (event: MessageAudioFailedEvent) => controller.handleFailed(event),
      [controller],
    ),
    toggle: useCallback(
      (messageId: string, mediaUrl?: string) =>
        controller.toggle(messageId, mediaUrl),
      [controller],
    ),
    clear: useCallback(() => controller.reset(), [controller]),
  };
}
