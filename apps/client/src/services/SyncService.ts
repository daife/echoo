import type { StorageRuntime } from "../runtimes/contracts";

export class SyncService {
  constructor(private readonly storage: StorageRuntime) {}

  listPendingTasks() {
    return this.storage.listPendingSyncTasks();
  }
}
