import { decode, encode } from "@msgpack/msgpack";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { ClientOptions } from "ws";
import type { StoredFishAudioConfig } from "../runtime-config/runtime-config.types.js";
import { BillingService } from "../billing/billing.service.js";

export interface FishAudioTtsResult {
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

export type FishAudioWebSocketFactory = (
  url: string,
  options: ClientOptions,
) => WebSocket;

export class FishAudioTtsService {
  constructor(
    private readonly config: StoredFishAudioConfig,
    private readonly createSocket: FishAudioWebSocketFactory = (url, options) =>
      new WebSocket(url, options),
    private readonly billing = new BillingService(),
  ) {}

  isConfigured() {
    return Boolean(this.config.apiKey && this.config.referenceId);
  }

  createStream(onAudio: (chunk: Buffer) => void) {
    return new FishAudioTtsStream(
      this.config,
      onAudio,
      this.createSocket,
      this.billing,
    );
  }

  async synthesize(
    transcript: string,
    onAudio: (chunk: Buffer) => void,
  ): Promise<FishAudioTtsResult> {
    if (this.config.source === "platform")
      await this.billing.assertPlatformBalance();
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error("Fish Audio API key is not configured.");
    const referenceId = this.config.referenceId.trim();
    if (!referenceId)
      throw new Error("Fish Audio reference ID is not configured.");
    if (!transcript.trim())
      throw new Error("Fish Audio TTS transcript must not be empty.");

    const response = await fetch(this.config.httpUrl, {
      method: "POST",
      headers: fishAudioHeaders(apiKey, this.config.model),
      body: JSON.stringify(ttsRequest(this.config, referenceId, transcript)),
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(
        `Fish Audio TTS failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${detail ? `: ${detail}` : "."}`,
      );
    }
    if (!response.body)
      throw new Error("Fish Audio TTS returned an empty response body.");

    const reader = response.body.getReader();
    const audioChunks: Buffer[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      const chunk = Buffer.from(value);
      audioChunks.push(chunk);
      onAudio(chunk);
    }

    if (!audioChunks.length)
      throw new Error("Fish Audio TTS returned no audio data.");
    if (this.config.source === "platform")
      await this.billing.chargeUsage({
        service: "fish_audio",
        model: this.config.model,
        upstreamRequestId: `fish_${randomUUID()}`,
        upstreamCostUsd: fishAudioCost(transcript, this.config.model),
        metadata: { utf8Bytes: Buffer.byteLength(transcript, "utf8") },
      });
    return audioResult(audioChunks);
  }
}

export class FishAudioTtsStream {
  private readonly socket: WebSocket;
  private readonly ready: Promise<void>;
  private readonly completed: Promise<FishAudioTtsResult>;
  private resolveCompleted!: (result: FishAudioTtsResult) => void;
  private rejectCompleted!: (error: Error) => void;
  private sendQueue = Promise.resolve();
  private readonly audioChunks: Buffer[] = [];
  private bufferedCharacters = 0;
  private readonly transcriptParts: string[] = [];
  private readonly usageId = `fish_${randomUUID()}`;
  private stopped = false;
  private settled = false;

  constructor(
    private readonly config: StoredFishAudioConfig,
    private readonly onAudio: (chunk: Buffer) => void,
    createSocket: FishAudioWebSocketFactory = (url, options) =>
      new WebSocket(url, options),
    private readonly billing = new BillingService(),
  ) {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error("Fish Audio API key is not configured.");
    const referenceId = this.config.referenceId.trim();
    if (!referenceId)
      throw new Error("Fish Audio reference ID is not configured.");

    this.completed = new Promise((resolve, reject) => {
      this.resolveCompleted = resolve;
      this.rejectCompleted = reject;
    });
    void this.completed.catch(() => undefined);

    this.socket = createSocket(this.config.wsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        model: this.config.model,
      },
    });
    this.socket.binaryType = "arraybuffer";
    const socketReady = new Promise<void>((resolve, reject) => {
      this.socket.once("open", () => {
        resolve();
      });
      this.socket.once("error", (error) => reject(error));
    });
    this.ready = Promise.all([
      socketReady,
      this.config.source === "platform"
        ? this.billing.assertPlatformBalance()
        : Promise.resolve(),
    ]).then(() => {
      this.send({
        event: "start",
        request: ttsRequest(this.config, referenceId, ""),
      });
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
      this.transcriptParts.push(text);
      this.bufferedCharacters += Array.from(text).length;
      this.send({ event: "text", text });
      if (this.shouldFlush(text)) {
        this.send({ event: "flush" });
        this.bufferedCharacters = 0;
      }
    });
  }

  async finish(): Promise<FishAudioTtsResult> {
    if (!this.stopped) {
      this.stopped = true;
      this.enqueue(async () => {
        if (this.bufferedCharacters > 0) this.send({ event: "flush" });
        this.send({ event: "stop" });
      });
    }
    await this.sendQueue;
    const result = await this.completed;
    if (this.config.source === "platform") {
      const transcript = this.transcriptParts.join("");
      await this.billing.chargeUsage({
        service: "fish_audio",
        model: this.config.model,
        upstreamRequestId: this.usageId,
        upstreamCostUsd: fishAudioCost(transcript, this.config.model),
        metadata: {
          utf8Bytes: Buffer.byteLength(transcript, "utf8"),
          streaming: true,
        },
      });
    }
    return result;
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
        this.resolveCompleted(audioResult(this.audioChunks));
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

function fishAudioHeaders(apiKey: string, model?: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "audio/mpeg",
    model: model ?? "s2.1-pro-free",
  };
}

function ttsRequest(
  config: StoredFishAudioConfig,
  referenceId: string,
  text: string,
) {
  return {
    text,
    format: "mp3",
    latency: config.latency,
    chunk_length: config.chunkLength,
    reference_id: referenceId,
  };
}

function audioResult(audioChunks: Buffer[]): FishAudioTtsResult {
  return {
    audio: Buffer.concat(audioChunks),
    mimeType: "audio/mpeg",
    format: "mp3",
  };
}

async function readErrorDetail(response: Response) {
  try {
    return (await response.text()).trim().slice(0, 2_000);
  } catch {
    return "";
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function fishAudioCost(text: string, model: string) {
  const pricePerMillionBytes = model.toLowerCase().includes("free") ? 0 : 15;
  return (
    (Buffer.byteLength(text, "utf8") * pricePerMillionBytes) / 1_000_000
  );
}
