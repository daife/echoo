import type {
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldRun,
  PrimeWorldSnapshot,
  PrimeWorldValidationIssue,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class PrimeWorldApi {
  constructor(private readonly client: ApiClient) {}
  getSnapshot(conversationId: string) {
    return this.client.get<PrimeWorldSnapshot & { stateVersion: number }>(
      `/prime-world/${conversationId}`,
    );
  }
  dispatch(conversationId: string, event: PrimeWorldEventInput) {
    return this.client.post<{ run: PrimeWorldRun }>(
      `/prime-world/${conversationId}/events`,
      event,
    );
  }
  getRun(conversationId: string, runId: string) {
    return this.client.get<{ run: PrimeWorldRun }>(
      `/prime-world/${conversationId}/runs/${runId}`,
    );
  }
  cancel(conversationId: string, runId: string) {
    return this.client.post<{ cancelled: boolean }>(
      `/prime-world/${conversationId}/runs/${runId}/cancel`,
      {},
    );
  }
  validate(detail: PrimeWorldDetail) {
    return this.client.post<{
      valid: boolean;
      issues: PrimeWorldValidationIssue[];
    }>(`/prime-world/validate`, detail);
  }
}
