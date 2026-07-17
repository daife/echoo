import type { SyncBootstrap, SyncPage } from "@echoo/shared";
import type { ApiClient } from "./client";

export class SyncApi {
  constructor(private readonly client: ApiClient) {}

  list(after: number, limit = 500) {
    return this.client.get<SyncPage>("/sync", { after, limit });
  }

  bootstrap() {
    return this.client.get<SyncBootstrap>("/sync/bootstrap");
  }

  createRealtimeTicket() {
    return this.client.post<{ ticket: string; expiresAt: number }>(
      "/realtime/ticket",
    );
  }
}
