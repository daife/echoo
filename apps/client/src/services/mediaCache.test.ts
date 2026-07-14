import { describe, expect, it, vi } from "vitest";
import {
  getCacheableMediaKey,
  MediaCache,
  type CachedMediaRecord,
  type MediaCacheStore,
} from "./mediaCache";

class MemoryMediaStore implements MediaCacheStore {
  readonly records = new Map<string, CachedMediaRecord>();

  async get(key: string) {
    return this.records.get(key);
  }

  async put(record: CachedMediaRecord) {
    this.records.set(record.key, record);
  }

  async delete(keys: string[]) {
    keys.forEach((key) => this.records.delete(key));
  }

  async list() {
    return Array.from(this.records.values());
  }
}

const mediaUrl = "/api/resources/res_1/file";

describe("persistent media cache", () => {
  it("returns a stored blob without fetching it again", async () => {
    const store = new MemoryMediaStore();
    const key = getCacheableMediaKey(mediaUrl) as string;
    const blob = new Blob(["cached"], { type: "image/jpeg" });
    store.records.set(key, {
      key,
      blob,
      size: blob.size,
      mimeType: blob.type,
      lastAccessedAt: 1,
    });
    const fetcher = vi.fn<typeof fetch>();
    const cache = new MediaCache(store, fetcher, () => 2);

    await expect(cache.get(mediaUrl)).resolves.toBe(blob);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent cache misses", async () => {
    const store = new MemoryMediaStore();
    const blob = new Blob(["fresh"], { type: "image/jpeg" });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(blob));
    const cache = new MediaCache(store, fetcher);

    const [first, second] = await Promise.all([
      cache.get(mediaUrl),
      cache.get(mediaUrl),
    ]);

    expect(first).toEqual(blob);
    expect(second).toEqual(blob);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(getCacheableMediaKey(mediaUrl), {
      cache: "force-cache",
    });
  });

  it("evicts least recently used blobs down to the target size", async () => {
    const store = new MemoryMediaStore();
    let now = 0;
    const cache = new MediaCache(store, fetch, () => ++now, {
      maximumBytes: 10,
      targetBytes: 6,
    });

    await cache.put("/api/resources/res_old/file", new Blob(["123456"]));
    await cache.put("/api/resources/res_new/file", new Blob(["abcdef"]));

    expect(Array.from(store.records.keys())).toEqual([
      getCacheableMediaKey("/api/resources/res_new/file"),
    ]);
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
      delete: async () => undefined,
      list: async () => {
        throw new Error("unavailable");
      },
    };
    const cache = new MediaCache(
      unavailableStore,
      vi.fn<typeof fetch>(async () => new Response(blob)),
    );

    await expect(cache.get(mediaUrl)).resolves.toEqual(blob);
  });

  it("does not persist blob, data, or external URLs", async () => {
    expect(getCacheableMediaKey("blob:preview")).toBeNull();
    expect(getCacheableMediaKey("data:image/png;base64,AA==")).toBeNull();
    expect(getCacheableMediaKey("https://example.com/image.jpg")).toBeNull();
  });
});
