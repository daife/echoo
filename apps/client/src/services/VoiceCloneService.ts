import type { ResourcesApi, VoiceClonesApi } from "@echoo/api-client";
import type { CreateVoiceCloneRequest } from "@echoo/shared/voice-clones";

export class VoiceCloneService {
  constructor(
    private readonly api: VoiceClonesApi,
    private readonly resources: ResourcesApi,
  ) {}

  listMine() {
    return this.api.listMine();
  }

  async create(
    input: Omit<CreateVoiceCloneRequest, "sampleResourceId"> & { sample: Blob },
  ) {
    const ticket = await this.resources.createUpload({
      kind: "voice_clone_sample",
      fileName: "voice-clone-sample.mp3",
      mimeType: "audio/mpeg",
      byteSize: input.sample.size,
    });
    await this.resources.upload(ticket, input.sample);
    await this.resources.complete(ticket.resourceId);
    for (const delayMs of [400, 800, 1_200, 2_000, 3_000, 4_000, 5_000]) {
      await delay(delayMs);
      const status = await this.resources.status(ticket.resourceId);
      if (status.status === "failed") throw new Error("音色样本处理失败。");
      if (status.status === "ready")
        return this.api.create({
          name: input.name,
          description: input.description,
          consentConfirmed: input.consentConfirmed,
          sampleResourceId: ticket.resourceId,
        });
    }
    throw new Error("音色样本处理超时，请稍后重试。");
  }

  delete(id: string) {
    return this.api.delete(id);
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
