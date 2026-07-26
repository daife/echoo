import type { MediaAccessItem, MediaVariant } from "@echoo/shared";

const DATABASE_NAME = "echoo-media-cache";
const DATABASE_VERSION = 3;
const METADATA_STORE = "metadata";
const CACHE_NAME = "echoo-media-bodies-v3";
const LEGACY_CACHE_NAMES = ["echoo-media-bodies-v2"];
const FALLBACK_BUDGET_BYTES = 128 * 1024 * 1024;
const MAXIMUM_BUDGET_BYTES = 512 * 1024 * 1024;
const TARGET_RATIO = 0.8;
const MAX_CONCURRENT_DOWNLOADS = 4;
const CACHE_READ_TIMEOUT_MS = 250;
const CACHE_WRITE_TIMEOUT_MS = 1_000;
const CACHE_TIMEOUT = Symbol("media-cache-timeout");

export interface CachedMediaMetadata {
  key: string;
  size: number;
  mimeType: string;
  lastAccessedAt: number;
  etag?: string;
}

export interface CachedMediaEntry {
  metadata: CachedMediaMetadata;
  response: Response;
}

export interface MediaCacheStore {
  get(key: string): Promise<CachedMediaEntry | undefined>;
  put(
    key: string,
    response: Response,
    metadata: CachedMediaMetadata,
  ): Promise<void>;
  touch(metadata: CachedMediaMetadata): Promise<void>;
  delete(keys: string[]): Promise<void>;
  listMetadata(): Promise<CachedMediaMetadata[]>;
  clear(): Promise<void>;
}

type MediaFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface MediaCacheSession {
  userId: string;
  getAccessToken: () => Promise<string | null>;
}

export class MediaCache {
  private readonly inFlight = new Map<string, Promise<Blob | null>>();
  private readonly accessUrls = new Map<string, MediaAccessItem>();
  private readonly variantAliases = new Map<string, MediaVariant>();
  private readonly pendingAccess = new Map<
    string,
    {
      resourceId: string;
      variant: MediaVariant;
      resolve: (value: MediaAccessItem | null) => void;
    }[]
  >();
  private accessFlushScheduled = false;
  private activeDownloads = 0;
  private readonly downloadWaiters: Array<() => void> = [];
  private session?: MediaCacheSession;

  constructor(
    private readonly store: MediaCacheStore = new BrowserMediaCacheStore(),
    // Calling a saved Window.fetch as `this.fetcher()` gives it MediaCache as
    // its receiver. Chromium rejects that with "Illegal invocation".
    private readonly fetcher: MediaFetcher = (input, init) =>
      fetch(input, init),
    private readonly now: () => number = Date.now,
    private readonly fixedBudgetBytes?: number,
  ) {}

  configure(session?: MediaCacheSession) {
    if (this.session?.userId !== session?.userId) {
      this.accessUrls.clear();
      this.variantAliases.clear();
    }
    this.session = session;
  }

  async get(
    mediaUrl: string,
    variant: MediaVariant = "display",
    signal?: AbortSignal,
  ): Promise<Blob | null> {
    const resourceId = getResourceId(mediaUrl);
    if (!resourceId || !this.session) return null;
    return waitForConsumer(this.resolveBlob(resourceId, variant), signal);
  }

  getByResourceId(
    resourceId: string,
    variant: MediaVariant = "display",
    signal?: AbortSignal,
  ) {
    return this.get(resourcePath(resourceId), variant, signal);
  }

  getDirectUrlByResourceId(
    resourceId: string,
    variant: MediaVariant = "display",
  ) {
    return this.getDirectUrl(resourcePath(resourceId), variant);
  }

  async getDirectUrl(mediaUrl: string, variant: MediaVariant = "original") {
    const resourceId = getResourceId(mediaUrl);
    if (!resourceId || !this.session) return resolveMediaUrl(mediaUrl);
    return (await this.resolveAccess(resourceId, variant))?.url;
  }

  async put(
    mediaUrl: string,
    blob: Blob,
    variant: MediaVariant = "original",
  ): Promise<void> {
    const resourceId = getResourceId(mediaUrl);
    if (!resourceId || !this.session || !blob.size) return;
    const budget = await this.getBudgetBytes();
    if (blob.size > budget * 0.25) return;
    const key = this.cacheKey(resourceId, variant);
    this.variantAliases.set(this.accessKey(resourceId, variant), variant);
    await this.storeBestEffort(
      key,
      new Response(blob),
      {
        key,
        size: blob.size,
        mimeType: blob.type,
        lastAccessedAt: this.now(),
      },
      budget,
    );
  }

  async delete(mediaUrls: Iterable<string | undefined>): Promise<void> {
    if (!this.session) return;
    const keys: string[] = [];
    for (const mediaUrl of mediaUrls) {
      const resourceId = mediaUrl ? getResourceId(mediaUrl) : null;
      if (!resourceId) continue;
      for (const key of this.variantAliases.keys())
        if (key.startsWith(`${resourceId}:`)) this.variantAliases.delete(key);
      for (const variant of ["original", "thumb", "display"] as const)
        keys.push(this.cacheKey(resourceId, variant));
    }
    if (keys.length) await this.store.delete(keys).catch(() => undefined);
  }

  async clearCurrentUser() {
    const prefix = this.session ? `${this.session.userId}:` : "";
    if (!prefix) return;
    const keys = (await this.store.listMetadata())
      .filter((record) => record.key.startsWith(prefix))
      .map((record) => record.key);
    if (keys.length) await this.store.delete(keys);
    this.accessUrls.clear();
    this.variantAliases.clear();
  }

  private async resolveBlob(
    resourceId: string,
    requestedVariant: MediaVariant,
  ) {
    const requestedKey = this.cacheKey(resourceId, requestedVariant);
    const knownVariant =
      this.variantAliases.get(this.accessKey(resourceId, requestedVariant)) ??
      requestedVariant;
    const knownKey = this.cacheKey(resourceId, knownVariant);
    const activeRequest =
      this.inFlight.get(knownKey) ?? this.inFlight.get(requestedKey);
    if (activeRequest) return activeRequest;

    const cached = await this.readCached(knownKey);
    if (cached) return cached;

    const access = await this.resolveAccess(resourceId, requestedVariant);
    if (!access) return null;
    const canonicalVariant = access.variant;
    const canonicalKey = this.cacheKey(resourceId, canonicalVariant);
    this.variantAliases.set(
      this.accessKey(resourceId, requestedVariant),
      canonicalVariant,
    );
    this.variantAliases.set(
      this.accessKey(resourceId, canonicalVariant),
      canonicalVariant,
    );

    const canonicalRequest = this.inFlight.get(canonicalKey);
    if (canonicalRequest) return canonicalRequest;
    if (canonicalKey !== knownKey) {
      const canonicalCached = await this.readCached(canonicalKey);
      if (canonicalCached) return canonicalCached;
      const requestAfterRead = this.inFlight.get(canonicalKey);
      if (requestAfterRead) return requestAfterRead;
    }

    const request = this.download(canonicalKey, access);
    this.inFlight.set(canonicalKey, request);
    this.inFlight.set(requestedKey, request);
    void request.finally(() => {
      if (this.inFlight.get(canonicalKey) === request)
        this.inFlight.delete(canonicalKey);
      if (this.inFlight.get(requestedKey) === request)
        this.inFlight.delete(requestedKey);
    });
    return request;
  }

  private async readCached(key: string) {
    try {
      const cached = await within(this.store.get(key), CACHE_READ_TIMEOUT_MS);
      if (cached !== CACHE_TIMEOUT && cached) {
        void this.store
          .touch({
            ...cached.metadata,
            lastAccessedAt: this.now(),
          })
          .catch(() => undefined);
        return cached.response.blob();
      }
    } catch {
      // Continue with an authorized network request.
    }
    return null;
  }

  private async download(key: string, access: MediaAccessItem) {
    await this.acquireDownloadSlot();
    try {
      const response = await this.fetcher(resolveMediaUrl(access.url)!, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      const cacheResponse = response.clone();
      const blob = await response.blob();
      if (!blob.size) return null;
      const budget = await this.getBudgetBytes();
      if (blob.size <= budget * 0.25) {
        void this.storeBestEffort(
          key,
          cacheResponse,
          {
            key,
            size: blob.size,
            mimeType: blob.type || access.mimeType,
            lastAccessedAt: this.now(),
            ...(access.etag ? { etag: access.etag } : {}),
          },
          budget,
        );
      }
      return blob;
    } catch {
      return null;
    } finally {
      this.releaseDownloadSlot();
    }
  }

  private async resolveAccess(resourceId: string, variant: MediaVariant) {
    if (!this.session) return null;
    const key = this.accessKey(resourceId, variant);
    const actualVariant = this.variantAliases.get(key);
    const cached =
      this.accessUrls.get(key) ??
      (actualVariant
        ? this.accessUrls.get(this.accessKey(resourceId, actualVariant))
        : undefined);
    if (cached && cached.expiresAt > this.now() + 30_000) return cached;
    return new Promise<MediaAccessItem | null>((resolve) => {
      const pending = this.pendingAccess.get(key) ?? [];
      pending.push({ resourceId, variant, resolve });
      this.pendingAccess.set(key, pending);
      if (this.accessFlushScheduled) return;
      this.accessFlushScheduled = true;
      queueMicrotask(() => void this.flushAccessRequests());
    });
  }

  private async flushAccessRequests() {
    this.accessFlushScheduled = false;
    const batches = [...this.pendingAccess.entries()];
    this.pendingAccess.clear();
    if (!batches.length || !this.session) return;
    const token = await this.session.getAccessToken();
    if (!token) {
      batches.forEach(([, waiters]) =>
        waiters.forEach((waiter) => waiter.resolve(null)),
      );
      return;
    }
    for (let offset = 0; offset < batches.length; offset += 50) {
      const chunk = batches.slice(offset, offset + 50);
      try {
        const response = await this.fetcher(
          `${getApiOrigin()}/api/resources/access`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              items: chunk.map(([, [waiter]]) => ({
                resourceId: waiter!.resourceId,
                variant: waiter!.variant,
              })),
            }),
          },
        );
        const payload = response.ok
          ? ((await response.json()) as { items?: MediaAccessItem[] })
          : {};
        for (const [index, [key, waiters]] of chunk.entries()) {
          const first = waiters[0]!;
          const candidate = payload.items?.[index];
          const item =
            candidate &&
            "url" in candidate &&
            candidate.resourceId === first.resourceId
              ? candidate
              : undefined;
          if (item) {
            this.accessUrls.set(key, item);
            this.accessUrls.set(
              this.accessKey(item.resourceId, item.variant),
              item,
            );
            this.variantAliases.set(key, item.variant);
            this.variantAliases.set(
              this.accessKey(item.resourceId, item.variant),
              item.variant,
            );
          }
          waiters.forEach((waiter) => waiter.resolve(item ?? null));
        }
      } catch {
        chunk.forEach(([, waiters]) =>
          waiters.forEach((waiter) => waiter.resolve(null)),
        );
      }
    }
  }

  private async acquireDownloadSlot(signal?: AbortSignal) {
    if (this.activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      this.activeDownloads += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal?.removeEventListener("abort", abort);
        this.activeDownloads += 1;
        resolve();
      };
      const abort = () => {
        const index = this.downloadWaiters.indexOf(resume);
        if (index >= 0) this.downloadWaiters.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      this.downloadWaiters.push(resume);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private releaseDownloadSlot() {
    this.activeDownloads = Math.max(0, this.activeDownloads - 1);
    this.downloadWaiters.shift()?.();
  }

  private async getBudgetBytes() {
    if (this.fixedBudgetBytes) return this.fixedBudgetBytes;
    try {
      const quota = (await navigator.storage?.estimate())?.quota;
      return quota
        ? Math.min(Math.floor(quota * 0.1), MAXIMUM_BUDGET_BYTES)
        : FALLBACK_BUDGET_BYTES;
    } catch {
      return FALLBACK_BUDGET_BYTES;
    }
  }

  private async prune(budget: number) {
    const records = await this.store.listMetadata();
    let totalBytes = records.reduce((sum, record) => sum + record.size, 0);
    if (totalBytes <= budget) return;
    const keys: string[] = [];
    for (const record of records.sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt,
    )) {
      keys.push(record.key);
      totalBytes -= record.size;
      if (totalBytes <= budget * TARGET_RATIO) break;
    }
    await this.store.delete(keys);
  }

  private cacheKey(resourceId: string, variant: MediaVariant) {
    return `${this.session!.userId}:${resourceId}:${variant}`;
  }

  private accessKey(resourceId: string, variant: MediaVariant) {
    return `${resourceId}:${variant}`;
  }

  private async storeBestEffort(
    key: string,
    response: Response,
    metadata: CachedMediaMetadata,
    budget: number,
  ) {
    try {
      const stored = await within(
        this.store.put(key, response, metadata),
        CACHE_WRITE_TIMEOUT_MS,
      );
      if (stored !== CACHE_TIMEOUT)
        await within(this.prune(budget), CACHE_WRITE_TIMEOUT_MS);
    } catch {
      // Persistent caching must never block media delivery.
    }
  }
}

class BrowserMediaCacheStore implements MediaCacheStore {
  private databasePromise?: Promise<IDBDatabase>;

  async get(key: string) {
    const metadata = await this.getMetadata(key);
    if (!metadata || typeof caches === "undefined") return undefined;
    const response = await (
      await caches.open(CACHE_NAME)
    ).match(cacheRequest(key));
    if (!response) {
      await this.delete([key]);
      return undefined;
    }
    return { metadata, response };
  }

  async put(key: string, response: Response, metadata: CachedMediaMetadata) {
    if (typeof caches === "undefined")
      throw new Error("Cache Storage unavailable.");
    await (await caches.open(CACHE_NAME)).put(cacheRequest(key), response);
    const store = await this.getStore("readwrite");
    await requestToPromise(store.put(metadata));
  }

  async touch(metadata: CachedMediaMetadata) {
    const store = await this.getStore("readwrite");
    await requestToPromise(store.put(metadata));
  }

  async delete(keys: string[]) {
    const database = await this.openDatabase();
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    const cache =
      typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
    await Promise.all(
      keys.map(async (key) => {
        store.delete(key);
        await cache?.delete(cacheRequest(key));
      }),
    );
    await transactionToPromise(transaction);
  }

  async listMetadata() {
    const store = await this.getStore("readonly");
    return requestToPromise<CachedMediaMetadata[]>(store.getAll());
  }

  async clear() {
    const records = await this.listMetadata();
    await this.delete(records.map((record) => record.key));
  }

  private async getMetadata(key: string) {
    const store = await this.getStore("readonly");
    return requestToPromise<CachedMediaMetadata | undefined>(store.get(key));
  }

  private async getStore(mode: IDBTransactionMode) {
    const database = await this.openDatabase();
    return database
      .transaction(METADATA_STORE, mode)
      .objectStore(METADATA_STORE);
  }

  private openDatabase() {
    if (this.databasePromise) return this.databasePromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined")
        return reject(new Error("IndexedDB unavailable."));
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        if (typeof caches !== "undefined")
          void Promise.all(
            LEGACY_CACHE_NAMES.map((name) => caches.delete(name)),
          );
        for (const name of Array.from(request.result.objectStoreNames))
          request.result.deleteObjectStore(name);
        request.result.createObjectStore(METADATA_STORE, { keyPath: "key" });
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        if (this.databasePromise === opening) this.databasePromise = undefined;
        reject(new Error("IndexedDB upgrade blocked by another page."));
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          if (this.databasePromise === opening)
            this.databasePromise = undefined;
        };
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        if (this.databasePromise === opening) this.databasePromise = undefined;
        reject(request.error ?? new Error("IndexedDB open failed."));
      };
    });
    this.databasePromise = opening;
    return opening;
  }
}

async function within<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof CACHE_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(CACHE_TIMEOUT), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cacheRequest(key: string) {
  return new Request(
    `${getApiOrigin()}/__echoo_media_cache__/${encodeURIComponent(key)}`,
  );
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

function waitForConsumer(request: Promise<Blob | null>, signal?: AbortSignal) {
  if (!signal) return request;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<Blob | null>((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    void request.then((blob) => {
      signal.removeEventListener("abort", onAbort);
      resolve(signal.aborted ? null : blob);
    });
  });
}

export function resolveMediaUrl(mediaUrl?: string) {
  if (!mediaUrl) return undefined;
  if (/^(?:https?:|blob:|data:)/.test(mediaUrl)) return mediaUrl;
  return new URL(mediaUrl, getApiOrigin()).toString();
}

export function getResourceId(mediaUrl?: string) {
  const resolved = resolveMediaUrl(mediaUrl);
  if (!resolved || /^(?:blob:|data:)/.test(resolved)) return null;
  try {
    const url = new URL(resolved);
    if (url.origin !== getApiOrigin()) return null;
    return url.pathname.match(/^\/api\/resources\/([^/]+)\/file$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function getCacheableMediaKey(mediaUrl: string) {
  return getResourceId(mediaUrl) ? resolveMediaUrl(mediaUrl)! : null;
}

function resourcePath(resourceId: string) {
  return `/api/resources/${encodeURIComponent(resourceId)}/file`;
}

function getApiOrigin() {
  const apiBase =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  return new URL(apiBase).origin;
}

export const mediaCache = new MediaCache();
