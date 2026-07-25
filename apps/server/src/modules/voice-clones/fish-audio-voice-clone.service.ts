import type { VoiceCloneState } from "@echoo/shared/voice-clones";
import { environment } from "../../infra/config/environment.js";

export class FishAudioVoiceCloneError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FishAudioVoiceCloneError";
  }
}

export class FishAudioVoiceCloneService {
  private readonly baseUrl = "https://api.fish.audio/model";

  constructor(
    private readonly apiKey = environment.platformFishAudioApiKey,
  ) {}

  async create(input: {
    name: string;
    description: string;
    audio: Uint8Array;
  }) {
    const form = new FormData();
    form.set("type", "tts");
    form.set("title", input.name);
    form.set("description", input.description);
    form.set("train_mode", "fast");
    form.set("visibility", "private");
    form.set("enhance_audio_quality", "true");
    form.set("generate_sample", "false");
    const audio = new Uint8Array(input.audio.byteLength);
    audio.set(input.audio);
    form.append(
      "voices",
      new Blob([audio], { type: "audio/mpeg" }),
      "voice-clone-sample.mp3",
    );
    const response = await this.request(this.baseUrl, {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as { _id?: unknown; state?: unknown };
    if (typeof payload._id !== "string" || !isState(payload.state))
      throw new FishAudioVoiceCloneError("Fish Audio 返回了无效的音色模型数据。");
    return { referenceId: payload._id, state: payload.state };
  }

  async get(referenceId: string) {
    const response = await this.request(`${this.baseUrl}/${encodeURIComponent(referenceId)}`);
    const payload = (await response.json()) as { state?: unknown };
    if (!isState(payload.state))
      throw new FishAudioVoiceCloneError("Fish Audio 返回了无效的训练状态。");
    return payload.state;
  }

  async delete(referenceId: string) {
    const response = await this.request(
      `${this.baseUrl}/${encodeURIComponent(referenceId)}`,
      { method: "DELETE" },
      true,
    );
    if (response.status !== 404 && !response.ok)
      throw await fishError(response);
  }

  private async request(url: string, init: RequestInit = {}, allowNotFound = false) {
    const apiKey = this.apiKey.trim();
    if (!apiKey)
      throw new FishAudioVoiceCloneError("平台尚未配置 Fish Audio API Key。");
    const signal = AbortSignal.timeout(60_000);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
        signal,
      });
    } catch (error) {
      throw new FishAudioVoiceCloneError(
        error instanceof Error && error.name === "TimeoutError"
          ? "Fish Audio 请求超时，请稍后重试。"
          : "暂时无法连接 Fish Audio，请稍后重试。",
      );
    }
    if (!response.ok && !(allowNotFound && response.status === 404))
      throw await fishError(response);
    return response;
  }
}

async function fishError(response: Response) {
  let message = `Fish Audio 请求失败（${response.status}）。`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) message = body.message;
  } catch {
    // Preserve the stable fallback when the upstream body is not JSON.
  }
  return new FishAudioVoiceCloneError(message, response.status);
}

function isState(value: unknown): value is VoiceCloneState {
  return value === "created" || value === "training" || value === "trained" || value === "failed";
}
