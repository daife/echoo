import type {
  CreateVoiceCloneRequest,
  VoiceClone,
} from "@echoo/shared/voice-clones";
import type { ApiClient } from "./client";

export class VoiceClonesApi {
  constructor(private readonly client: ApiClient) {}

  listMine() {
    return this.client.get<VoiceClone[]>("/voice-clones");
  }

  create(input: CreateVoiceCloneRequest) {
    return this.client.post<VoiceClone>("/voice-clones", input);
  }

  delete(id: string) {
    return this.client.delete<{ deleted: true }>(`/voice-clones/${id}`);
  }
}
