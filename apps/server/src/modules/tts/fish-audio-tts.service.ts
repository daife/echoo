export interface FishAudioTtsResult {
  audio: Buffer;
  mimeType: "audio/mpeg";
  format: "mp3";
}

export class FishAudioTtsService {
  isConfigured() {
    return Boolean(
      process.env.FISH_AUDIO_API_KEY && process.env.FISH_AUDIO_REFERENCE_ID,
    );
  }

  async synthesize(
    transcript: string,
    onAudio: (chunk: Buffer) => void,
  ): Promise<FishAudioTtsResult> {
    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) throw new Error("FISH_AUDIO_API_KEY is not configured.");
    const referenceId = process.env.FISH_AUDIO_REFERENCE_ID?.trim();
    if (!referenceId)
      throw new Error("FISH_AUDIO_REFERENCE_ID is not configured.");
    if (!transcript.trim())
      throw new Error("Fish Audio TTS transcript must not be empty.");

    const response = await fetch(
      process.env.FISH_AUDIO_TTS_URL ?? "https://api.fish.audio/v1/tts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          model: process.env.FISH_AUDIO_MODEL ?? "s2.1-pro-free",
        },
        body: JSON.stringify({
          text: transcript,
          format: "mp3",
          latency: process.env.FISH_AUDIO_LATENCY ?? "balanced",
          chunk_length: Number(process.env.FISH_AUDIO_CHUNK_LENGTH ?? 100),
          reference_id: referenceId,
        }),
      },
    );

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
    return {
      audio: Buffer.concat(audioChunks),
      mimeType: "audio/mpeg",
      format: "mp3",
    };
  }
}

async function readErrorDetail(response: Response) {
  try {
    return (await response.text()).trim().slice(0, 2_000);
  } catch {
    return "";
  }
}
