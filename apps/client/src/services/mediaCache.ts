const DATABASE_NAME = "echoo-media-cache";
const DATABASE_VERSION = 1;
const MEDIA_STORE = "media";

export const MEDIA_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
export const MEDIA_CACHE_TARGET_BYTES = 900 * 1024 * 1024;

export interface CachedMediaRecord {
  key: string;
  blob: Blob;
  size: number;
  mimeType: string;
  lastAccessedAt: number;
}

export interface MediaCacheStore {
  get(key: string): Promise<CachedMediaRecord | undefined>;
  put(record: CachedMediaRecord): Promise<void>;
  delete(keys: string[]): Promise<void>;
  list(): Promise<CachedMediaRecord[]>;
}

type MediaFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class MediaCache {
  private readonly inFlight = new Map<string, Promise<Blob | null>>();

  constructor(
    private readonly store: MediaCacheStore = new IndexedDbMediaCacheStore(),
    private readonly fetcher: MediaFetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly limits = {
      maximumBytes: MEDIA_CACHE_MAX_BYTES,
      targetBytes: MEDIA_CACHE_TARGET_BYTES,
    },
  ) {}

  async get(mediaUrl: string): Promise<Blob | null> {
    const key = getCacheableMediaKey(mediaUrl);
    if (!key) return null;
    const activeRequest = this.inFlight.get(key);
    if (activeRequest) return activeRequest;

    const request = this.load(key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  async put(mediaUrl: string, blob: Blob): Promise<void> {
    const key = getCacheableMediaKey(mediaUrl);
    if (!key || blob.size <= 0 || blob.size > this.limits.maximumBytes) return;
    try {
      await this.store.put(this.toRecord(key, blob));
      await this.prune();
    } catch {
      // HTTP caching remains the fallback when persistent storage is unavailable.
    }
  }

  async delete(mediaUrls: Iterable<string | undefined>): Promise<void> {
    const keys = Array.from(mediaUrls)
      .map((url) => (url ? getCacheableMediaKey(url) : null))
      .filter((key): key is string => Boolean(key));
    if (!keys.length) return;
    try {
      await this.store.delete(keys);
    } catch {
      // Cache cleanup must never block deleting a conversation.
    }
  }

  private async load(key: string): Promise<Blob | null> {
    try {
      const cached = await this.store.get(key);
      if (cached) {
        void this.store
          .put({ ...cached, lastAccessedAt: this.now() })
          .catch(() => undefined);
        return cached.blob;
      }
    } catch {
      // Continue with a normal force-cache request.
    }

    try {
      const response = await this.fetcher(key, { cache: "force-cache" });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.size) return null;
      await this.put(key, blob);
      return blob;
    } catch {
      return null;
    }
  }

  private toRecord(key: string, blob: Blob): CachedMediaRecord {
    return {
      key,
      blob,
      size: blob.size,
      mimeType: blob.type,
      lastAccessedAt: this.now(),
    };
  }

  private async prune() {
    const records = await this.store.list();
    let totalBytes = records.reduce((sum, record) => sum + record.size, 0);
    if (totalBytes <= this.limits.maximumBytes) return;

    const keysToDelete: string[] = [];
    for (const record of records.sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt,
    )) {
      keysToDelete.push(record.key);
      totalBytes -= record.size;
      if (totalBytes <= this.limits.targetBytes) break;
    }
    await this.store.delete(keysToDelete);
  }
}

class IndexedDbMediaCacheStore implements MediaCacheStore {
  private databasePromise?: Promise<IDBDatabase>;

  async get(key: string) {
    const store = await this.getStore("readonly");
    return requestToPromise<CachedMediaRecord | undefined>(store.get(key));
  }

  async put(record: CachedMediaRecord) {
    const store = await this.getStore("readwrite");
    await requestToPromise(store.put(record));
  }

  async delete(keys: string[]) {
    const database = await this.openDatabase();
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE);
    keys.forEach((key) => store.delete(key));
    await transactionToPromise(transaction);
  }

  async list() {
    const store = await this.getStore("readonly");
    return requestToPromise<CachedMediaRecord[]>(store.getAll());
  }

  private async getStore(mode: IDBTransactionMode) {
    const database = await this.openDatabase();
    return database.transaction(MEDIA_STORE, mode).objectStore(MEDIA_STORE);
  }

  private openDatabase() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(MEDIA_STORE)) {
          request.result.createObjectStore(MEDIA_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }
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

export function resolveMediaUrl(mediaUrl?: string) {
  if (!mediaUrl) return undefined;
  if (/^(?:https?:|blob:|data:)/.test(mediaUrl)) return mediaUrl;
  return new URL(mediaUrl, getApiOrigin()).toString();
}

export function getCacheableMediaKey(mediaUrl: string) {
  const resolved = resolveMediaUrl(mediaUrl);
  if (!resolved || /^(?:blob:|data:)/.test(resolved)) return null;
  try {
    const url = new URL(resolved);
    if (url.origin !== getApiOrigin()) return null;
    if (!/^\/api\/resources\/[^/]+\/file$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getApiOrigin() {
  const apiBase =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  return new URL(apiBase).origin;
}

export const mediaCache = new MediaCache();
