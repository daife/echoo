import type { CreateVoiceCloneRequest } from "@echoo/shared/voice-clones";
import { ResourceRepository } from "../resources/resource.repository.js";
import { FishAudioVoiceCloneService } from "./fish-audio-voice-clone.service.js";
import { VoiceCloneRepository } from "./voice-clone.repository.js";

export class VoiceCloneNotFoundError extends Error {}
export class VoiceCloneQuotaError extends Error {}
export class VoiceCloneSampleError extends Error {}

export class VoiceCloneService {
  constructor(
    private readonly repository = new VoiceCloneRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly fish = new FishAudioVoiceCloneService(),
  ) {}

  async list(ownerUserId: string) {
    const clones = await this.repository.list(ownerUserId);
    return Promise.all(
      clones.map(async (clone) => {
        if (clone.state === "trained" || clone.state === "failed") return clone;
        try {
          const state = await this.fish.get(clone.referenceId);
          if (state !== clone.state) await this.repository.updateState(clone.id, state);
          return { ...clone, state, updatedAt: state === clone.state ? clone.updatedAt : Date.now() };
        } catch {
          return clone;
        }
      }),
    );
  }

  async create(ownerUserId: string, input: CreateVoiceCloneRequest) {
    const sample = await this.resources.readForOwner(ownerUserId, input.sampleResourceId);
    if (
      !sample ||
      sample.record.kind !== "voice_clone_sample" ||
      sample.record.status !== "ready" ||
      sample.record.mimeType !== "audio/mpeg" ||
      sample.record.durationSeconds === undefined ||
      sample.record.durationSeconds < 10 ||
      sample.record.durationSeconds > 90.1
    )
      throw new VoiceCloneSampleError("音色样本不存在、尚未处理完成或时长不在 10–90 秒之间。");

    let reserved: { id: string } | null = null;
    let upstreamReferenceId: string | undefined;
    try {
      reserved = await this.repository.reserve(
        ownerUserId,
        input.name.trim(),
        input.description?.trim() ?? "",
      );
      if (!reserved)
        throw new VoiceCloneQuotaError("每位用户最多保留 5 个克隆音色。");
      const created = await this.fish.create({
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        audio: sample.data,
      });
      upstreamReferenceId = created.referenceId;
      const saved = await this.repository.complete(
        reserved.id,
        created.referenceId,
        created.state,
      );
      if (!saved) throw new Error("音色克隆保存失败。");
      return saved;
    } catch (error) {
      if (reserved)
        await this.repository.release(reserved.id).catch(() => undefined);
      if (upstreamReferenceId)
        await this.fish.delete(upstreamReferenceId).catch(() => undefined);
      throw error;
    } finally {
      await this.resources.deleteOrphanedResource(input.sampleResourceId).catch(() => undefined);
    }
  }

  async delete(ownerUserId: string, id: string) {
    const clone = await this.repository.findForOwner(ownerUserId, id);
    if (!clone) throw new VoiceCloneNotFoundError("未找到该克隆音色。");
    await this.fish.delete(clone.referenceId);
    await this.repository.deleteForOwner(ownerUserId, id);
  }
}
