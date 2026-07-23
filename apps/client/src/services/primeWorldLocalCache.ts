import type { Agent, PrimeWorldSnapshot } from "@echoo/shared";

const DATABASE_NAME = "echoo-prime-world-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "records";
const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60_000;

type StoredSnapshot = {
  kind: "snapshot";
  userId: string;
  conversationId: string;
  savedAt: number;
  value: PrimeWorldSnapshot & { stateVersion: number };
};

type StoredAgents = {
  kind: "agents";
  userId: string;
  savedAt: number;
  value: Agent[];
};

type StoredRecord = StoredSnapshot | StoredAgents;

export class PrimeWorldLocalCache {
  private databasePromise?: Promise<IDBDatabase>;

  async getSnapshot(userId: string, conversationId: string) {
    const record = await this.get<StoredSnapshot>(
      snapshotKey(userId, conversationId),
    );
    if (!record || Date.now() - record.savedAt > MAX_SNAPSHOT_AGE_MS)
      return null;
    return structuredClone(record.value);
  }

  async putSnapshot(
    userId: string,
    conversationId: string,
    value: PrimeWorldSnapshot & { stateVersion: number },
  ) {
    await this.put(snapshotKey(userId, conversationId), {
      kind: "snapshot",
      userId,
      conversationId,
      savedAt: Date.now(),
      value: structuredClone(value),
    } satisfies StoredSnapshot);
  }

  async updateSnapshotView(
    userId: string,
    conversationId: string,
    view: PrimeWorldSnapshot["state"]["view"],
    stateVersion: number,
  ) {
    const current = await this.getSnapshot(userId, conversationId);
    if (!current || current.stateVersion > stateVersion) return;
    await this.putSnapshot(userId, conversationId, {
      ...current,
      stateVersion,
      state: { ...current.state, view, updatedAt: Date.now() },
    });
  }

  async getAgents(userId: string) {
    const record = await this.get<StoredAgents>(agentsKey(userId));
    return record ? structuredClone(record.value) : [];
  }

  async putAgents(userId: string, agents: Agent[]) {
    await this.put(agentsKey(userId), {
      kind: "agents",
      userId,
      savedAt: Date.now(),
      value: structuredClone(agents),
    } satisfies StoredAgents);
  }

  private async get<T extends StoredRecord>(key: string): Promise<T | null> {
    if (typeof indexedDB === "undefined") return null;
    try {
      const store = await this.store("readonly");
      return (await requestToPromise<T | undefined>(store.get(key))) ?? null;
    } catch {
      return null;
    }
  }

  private async put(key: string, value: StoredRecord) {
    if (typeof indexedDB === "undefined") return;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      await transactionToPromise(transaction);
    } catch {
      // The cache is best-effort and must never block the online workflow.
    }
  }

  private async store(mode: IDBTransactionMode) {
    const database = await this.openDatabase();
    return database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  private openDatabase() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }
}

function snapshotKey(userId: string, conversationId: string) {
  return `snapshot:${userId}:${conversationId}`;
}

function agentsKey(userId: string) {
  return `agents:${userId}`;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const primeWorldLocalCache = new PrimeWorldLocalCache();
