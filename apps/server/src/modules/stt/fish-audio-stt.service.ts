import { randomUUID } from "node:crypto";
import { encode } from "@msgpack/msgpack";
import type { PrimeMediaAnnotation } from "@echoo/shared";
import type { PrimePendingMedia } from "../agents/kinds/prime-figure/prime-media-annotation.service.js";
import { BillingService } from "../billing/billing.service.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import type { StoredFishAudioSttConfig } from "../runtime-config/runtime-config.types.js";

export const FISH_AUDIO_ASR_MODEL = "transcribe-1";
export const FISH_AUDIO_ASR_USD_PER_AUDIO_HOUR = 0.36;

interface FishAudioAsrResponse {
  text: string;
  duration: number;
}

export class FishAudioSttService {
  constructor(
    private readonly resources = new ResourceRepository(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly billing = new BillingService(),
  ) {}

  async annotate(
    ownerUserId: string,
    media: PrimePendingMedia[],
    config: StoredFishAudioSttConfig,
  ): Promise<PrimeMediaAnnotation[]> {
    if (!media.length) return [];
    if (!config.apiKey)
      throw new Error("Fish Audio STT API key is not configured.");
    if (!config.httpUrl.trim())
      throw new Error("Fish Audio STT URL is not configured.");
    if (config.source === "platform")
      await this.billing.assertPlatformBalance();
    return Promise.all(
      media.map((item) => this.transcribe(ownerUserId, item, config)),
    );
  }

  private async transcribe(
    ownerUserId: string,
    item: PrimePendingMedia,
    config: StoredFishAudioSttConfig,
  ): Promise<PrimeMediaAnnotation> {
    if (item.type !== "voice")
      throw new Error(`Fish Audio STT 仅支持 voice 媒体：${item.id}。`);
    const resource = await this.resources.readForOwner(
      ownerUserId,
      item.resourceId,
    );
    if (!resource)
      throw new Error(`媒体资源不存在或不属于当前用户：${item.id}。`);

    const language = config.language.trim();
    const body = Buffer.from(
      encode({
        audio: resource.data,
        ignore_timestamps: true,
        ...(language ? { language } : {}),
      }),
    );
    const response = await this.fetcher(config.httpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/msgpack",
      },
      body,
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(
        `Fish Audio STT failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${detail ? `: ${detail}` : "."}`,
      );
    }

    const result = parseAsrResponse(await response.json());
    if (config.source === "platform") {
      const billedAudioSeconds = Math.ceil(result.duration);
      await this.billing.chargeUsage({
        service: "fish_audio",
        model: FISH_AUDIO_ASR_MODEL,
        upstreamRequestId:
          response.headers.get("x-request-id") ?? `fish_asr_${randomUUID()}`,
        upstreamCostUsd: fishAudioAsrCostUsd(result.duration),
        metadata: {
          audioSeconds: result.duration,
          billedAudioSeconds,
          pricePerAudioHourUsd: FISH_AUDIO_ASR_USD_PER_AUDIO_HOUR,
          operation: "asr",
        },
      });
    }
    return { id: item.id, type: "voice", transcript: result.text };
  }
}

export function fishAudioAsrCostUsd(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return (
    (Math.ceil(durationSeconds) / 3_600) * FISH_AUDIO_ASR_USD_PER_AUDIO_HOUR
  );
}

function parseAsrResponse(value: unknown): FishAudioAsrResponse {
  if (!value || typeof value !== "object")
    throw new Error("Fish Audio STT returned an invalid response.");
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new Error("Fish Audio STT returned an empty transcript.");
  const duration = Number(record.duration);
  if (!Number.isFinite(duration) || duration < 0)
    throw new Error("Fish Audio STT returned an invalid audio duration.");
  return { text, duration };
}

async function readErrorDetail(response: Response) {
  const text = (await response.text()).trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { message?: unknown; detail?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Keep the upstream text below.
  }
  return text.slice(0, 500);
}
