import type {
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldNodeCatalogEntry,
  PrimeWorldExportBundle,
  PrimeWorldRun,
  PrimeWorldRunTraceEntry,
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
  getCatalog() {
    return this.client.get<{ nodes: PrimeWorldNodeCatalogEntry[] }>("/prime-world/catalog");
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
  getTrace(conversationId: string, runId: string) {
    return this.client.get<{ trace: PrimeWorldRunTraceEntry[] }>(
      `/prime-world/${conversationId}/runs/${runId}/trace`,
    );
  }
  reset(conversationId: string) {
    return this.client.post<{ runId: string }>(`/prime-world/${conversationId}/reset`, {});
  }
  exportBundle(conversationId: string) {
    return this.client.get<PrimeWorldExportBundle>(`/prime-world/${conversationId}/export`);
  }
  importBundle(bundle: PrimeWorldExportBundle) {
    return this.client.post<{ agent: import("@echoo/shared").PrimeWorldAgent }>("/prime-world/import", bundle);
  }
  validate(detail: PrimeWorldDetail) {
    return this.client.post<{
      valid: boolean;
      issues: PrimeWorldValidationIssue[];
    }>(`/prime-world/validate`, detail);
  }
}
