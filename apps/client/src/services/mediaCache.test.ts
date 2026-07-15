import { describe, expect, it, vi } from "vitest";
import {
  getCacheableMediaKey,
  MediaCache,
  type CachedMediaEntry,
  type CachedMediaMetadata,
  type MediaCacheStore,
} from "./mediaCache";

class MemoryMediaStore implements MediaCacheStore {
  readonly records = new Map<string, CachedMediaEntry>();

  async get(key: string) {
    const entry = this.records.get(key);
    return entry
      ? { metadata: entry.metadata, response: entry.response.clone() }
      : undefined;
  }

  async put(key: string, response: Response, metadata: CachedMediaMetadata) {
    this.records.set(key, { metadata, response: response.clone() });
  }

  async touch(metadata: CachedMediaMetadata) {
    const entry = this.records.get(metadata.key);
    if (entry) this.records.set(metadata.key, { ...entry, metadata });
  }

  async delete(keys: string[]) {
    keys.forEach((key) => this.records.delete(key));
  }

  async listMetadata() {
    return Array.from(this.records.values(), (entry) => entry.metadata);
  }

  async clear() {
    this.records.clear();
  }
}

const mediaUrl = "/api/resources/res_1/file";

function configure(cache: MediaCache) {
  cache.configure({ userId: "user_1", getAccessToken: async () => "token" });
  return cache;
}

function accessAwareFetcher(blob: Blob) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/resources/access"))
      return new Response(
        JSON.stringify({
          items: [
            {
              resourceId: "res_1",
              variant: "display",
              url: "https://cdn.example/res_1-display",
              expiresAt: Date.now() + 600_000,
              mimeType: blob.type,
            },
          ],
        }),
      );
    return new Response(blob);
  });
}

describe("persistent media cache", () => {
  it("returns a stored body without fetching it again", async () => {
    const store = new MemoryMediaStore();
    const blob = new Blob(["cached"], { type: "image/jpeg" });
    store.records.set("user_1:res_1:display", {
      metadata: {
        key: "user_1:res_1:display",
        size: blob.size,
        mimeType: blob.type,
        lastAccessedAt: 1,
      },
      response: new Response(blob),
    });
    const fetcher = vi.fn<typeof fetch>();
    const cache = configure(new MediaCache(store, fetcher, () => 2, 100));

    await expect(cache.get(mediaUrl)).resolves.toEqual(blob);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent cache misses", async () => {
    const store = new MemoryMediaStore();
    const blob = new Blob(["fresh"], { type: "image/jpeg" });
    const fetcher = accessAwareFetcher(blob);
    const cache = configure(new MediaCache(store, fetcher, Date.now, 100));

    const [first, second] = await Promise.all([
      cache.get(mediaUrl),
      cache.get(mediaUrl),
    ]);

    expect(first).toEqual(blob);
    expect(second).toEqual(blob);
    expect(fetcher).toHaveBeenCalledTimes(2); // one access grant and one media body
  });

  it("evicts least recently used bodies down to the target size", async () => {
    const store = new MemoryMediaStore();
    let now = 0;
    const cache = configure(new MediaCache(store, fetch, () => ++now, 10));

    for (let index = 0; index < 6; index += 1)
      await cache.put(`/api/resources/res_${index}/file`, new Blob(["12"]));

    expect(store.records.size).toBe(4);
    expect(store.records.has("user_1:res_0:original")).toBe(false);
    expect(store.records.has("user_1:res_5:original")).toBe(true);
  });

  it("returns fetched media when persistent storage is unavailable", async () => {
    const blob = new Blob(["fallback"], { type: "audio/mpeg" });
    const unavailableStore: MediaCacheStore = {
      get: async () => {
        throw new Error("unavailable");
      },
      put: async () => {
        throw new Error("quota exceeded");
      },
      touch: async () => undefined,
      delete: async () => undefined,
      listMetadata: async () => [],
      clear: async () => undefined,
    };
    const cache = configure(
      new MediaCache(unavailableStore, accessAwareFetcher(blob), Date.now, 100),
    );

    await expect(cache.get(mediaUrl)).resolves.toEqual(blob);
  });

  it("does not treat blob, data, or external URLs as cacheable resources", () => {
    expect(getCacheableMediaKey("blob:preview")).toBeNull();
    expect(getCacheableMediaKey("data:image/png;base64,AA==")).toBeNull();
    expect(getCacheableMediaKey("https://example.com/image.jpg")).toBeNull();
  });
});
