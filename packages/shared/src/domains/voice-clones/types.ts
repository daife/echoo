export type VoiceCloneState = "created" | "training" | "trained" | "failed";

export interface VoiceClone {
  id: string;
  name: string;
  description: string;
  referenceId: string;
  state: VoiceCloneState;
  consentConfirmedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateVoiceCloneRequest {
  name: string;
  description?: string;
  sampleResourceId: string;
  consentConfirmed: true;
}
