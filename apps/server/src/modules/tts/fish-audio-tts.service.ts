import { decode, encode } from "@msgpack/msgpack";
import WebSocket from "ws";

export interface FishAudioStreamResult {
  audio: Buffer;
  mimeType: "audio/mpeg";
  format: "mp3";
}

type FishServerEvent = {
  event?: unknown;
  audio?: unknown;
  reason?: unknown;
  message?: unknown;
};

export class FishAudioTtsService {
  isConfigured() {
    return Boolean(
      process.env.FISH_AUDIO_API_KEY && process.env.FISH_AUDIO_REFERENCE_ID,
    );
  }

  createStream(onAudio: (chunk: Buffer) => void) {
    return new FishAudioTtsStream(onAudio);
  }
}

export class FishAudioTtsStream {
  private readonly socket: WebSocket;
  private readonly ready: Promise<void>;
  private readonly completed: Promise<FishAudioStreamResult>;
  private resolveCompleted!: (result: FishAudioStreamResult) => void;
  private rejectCompleted!: (error: Error) => void;
  private sendQueue = Promise.resolve();
  private readonly audioChunks: Buffer[] = [];
  private bufferedCharacters = 0;
  private stopped = false;
  private settled = false;

  constructor(private readonly onAudio: (chunk: Buffer) => void) {
    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) throw new Error("FISH_AUDIO_API_KEY is not configured.");
    const referenceId = process.env.FISH_AUDIO_REFERENCE_ID?.trim();
    if (!referenceId)
      throw new Error("FISH_AUDIO_REFERENCE_ID is not configured.");

    this.completed = new Promise((resolve, reject) => {
      this.resolveCompleted = resolve;
      this.rejectCompleted = reject;
    });
    // The caller consumes this promise in finish(); prevent an early socket
    // error from becoming an unhandled rejection in the meantime.
    void this.completed.catch(() => undefined);

    this.socket = new WebSocket(
      process.env.FISH_AUDIO_WS_URL ?? "wss://api.fish.audio/v1/tts/live",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          model: process.env.FISH_AUDIO_MODEL ?? "s2.1-pro-free",
        },
      },
    );
    this.socket.binaryType = "arraybuffer";
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", () => {
        try {
          this.send({
            event: "start",
            request: {
              text: "",
              format: "mp3",
              latency: process.env.FISH_AUDIO_LATENCY ?? "balanced",
              chunk_length: Number(process.env.FISH_AUDIO_CHUNK_LENGTH ?? 100),
              reference_id: referenceId,
            },
          });
          resolve();
        } catch (error) {
          reject(toError(error));
        }
      });
      this.socket.once("error", (error) => reject(error));
    });

    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => {
      if (!this.settled)
        this.fail(new Error("Fish Audio TTS stream closed before completion."));
    });
  }

  write(text: string) {
    if (!text || this.stopped) return;
    this.enqueue(async () => {
      this.bufferedCharacters += Array.from(text).length;
      this.send({ event: "text", text });
      if (this.shouldFlush(text)) {
        this.send({ event: "flush" });
        this.bufferedCharacters = 0;
      }
    });
  }

  async finish(): Promise<FishAudioStreamResult> {
    if (!this.stopped) {
      this.stopped = true;
      this.enqueue(async () => {
        if (this.bufferedCharacters > 0) this.send({ event: "flush" });
        this.send({ event: "stop" });
      });
    }
    await this.sendQueue;
    return this.completed;
  }

  abort() {
    if (this.settled) return;
    this.stopped = true;
    this.settled = true;
    this.socket.close(1000, "cancelled");
    this.rejectCompleted(new Error("Fish Audio TTS stream was cancelled."));
  }

  private enqueue(operation: () => Promise<void>) {
    this.sendQueue = this.sendQueue
      .then(() => this.ready)
      .then(operation)
      .catch((error) => this.fail(toError(error)));
  }

  private shouldFlush(text: string) {
    return this.bufferedCharacters >= 48 || /[。！？!?；;\n]\s*$/.test(text);
  }

  private send(payload: unknown) {
    if (this.socket.readyState !== WebSocket.OPEN)
      throw new Error("Fish Audio TTS socket is not open.");
    this.socket.send(encode(payload));
  }

  private handleMessage(data: WebSocket.RawData) {
    try {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(Buffer.isBuffer(data) ? data : Buffer.concat(data));
      const event = decode(bytes) as FishServerEvent;
      if (event.event === "audio" && event.audio instanceof Uint8Array) {
        const chunk = Buffer.from(event.audio);
        this.audioChunks.push(chunk);
        this.onAudio(chunk);
        return;
      }
      if (event.event === "finish") {
        if (typeof event.reason === "string" && event.reason !== "stop") {
          this.fail(new Error(`Fish Audio TTS failed: ${event.reason}`));
          return;
        }
        this.settled = true;
        this.resolveCompleted({
          audio: Buffer.concat(this.audioChunks),
          mimeType: "audio/mpeg",
          format: "mp3",
        });
        this.socket.close(1000, "finished");
      }
    } catch (error) {
      this.fail(toError(error));
    }
  }

  private fail(error: Error) {
    if (this.settled) return;
    this.stopped = true;
    this.settled = true;
    this.rejectCompleted(error);
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.close(1011, "tts error");
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
