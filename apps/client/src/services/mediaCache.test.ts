import { describe, expect, it, vi } from "vitest";
import {
  MediaCache,
  type CachedMediaEntry,
  type MediaCacheStore,
} from "./mediaCache";

const emptyStore: MediaCacheStore = {
  get: async () => undefined,
  put: async () => undefined,
  touch: async () => undefined,
  delete: async () => undefined,
  listMetadata: async () => [],
  clear: async () => undefined,
};

describe("MediaCache access URL batching", () => {
  it("combines same-turn access misses into one request", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/resources/access"))
          return new Response(
            JSON.stringify({
              items: [
                {
                  resourceId: "res_1",
                  variant: "display",
                  url: "https://download.test/res_1",
                  expiresAt: Date.now() + 60_000,
                  mimeType: "image/jpeg",
                },
                {
                  resourceId: "res_2",
                  variant: "display",
                  url: "https://download.test/res_2",
                  expiresAt: Date.now() + 60_000,
                  mimeType: "image/jpeg",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        return new Response(new Blob(["media"], { type: "image/jpeg" }), {
          status: 200,
        });
      },
    );
    const cache = new MediaCache(emptyStore, fetcher);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    await Promise.all([
      cache.get("/api/resources/res_1/file"),
      cache.get("/api/resources/res_2/file"),
    ]);

    const accessCalls = fetcher.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/resources/access"),
    );
    expect(accessCalls).toHaveLength(1);
    expect(JSON.parse(String(accessCalls[0]?.[1]?.body)).items).toHaveLength(2);
  });

  it("resolves resource IDs through the existing cache pipeline", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/resources/access"))
        return new Response(
          JSON.stringify({
            items: [
              {
                resourceId: "res_world",
                variant: "display",
                url: "https://download.test/res_world",
                expiresAt: Date.now() + 60_000,
                mimeType: "image/jpeg",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Blob(["world"], { type: "image/jpeg" }), {
        status: 200,
      });
    });
    const cache = new MediaCache(emptyStore, fetcher);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    const blob = await cache.getByResourceId("res_world", "display");

    expect(await blob?.text()).toBe("world");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses a persisted resource variant without downloading it again", async () => {
    const records = new Map<string, CachedMediaEntry>();
    const store: MediaCacheStore = {
      ...emptyStore,
      get: async (key) => records.get(key),
      put: async (key, response, metadata) => {
        records.set(key, { response, metadata });
      },
    };
    const fetcher = mediaFetcher();
    const cache = new MediaCache(store, fetcher, Date.now, 1024 * 1024);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    expect(
      await (await cache.getByResourceId("res_shared", "display"))?.text(),
    ).toBe("media");
    expect(
      await (await cache.getByResourceId("res_shared", "display"))?.text(),
    ).toBe("media");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a shared download alive when one consumer aborts", async () => {
    let finishDownload!: () => void;
    const downloadReady = new Promise<void>((resolve) => {
      finishDownload = resolve;
    });
    const fetcher = mediaFetcher(downloadReady);
    const cache = new MediaCache(emptyStore, fetcher);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });
    const controller = new AbortController();

    const cancelled = cache.getByResourceId(
      "res_shared",
      "display",
      controller.signal,
    );
    const active = cache.getByResourceId("res_shared", "display");
    controller.abort();
    finishDownload();

    expect(await cancelled).toBeNull();
    expect(await (await active)?.text()).toBe("media");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("aliases a missing display variant to original without downloading twice", async () => {
    const store = createMemoryStore();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/resources/access")) {
          const requested = JSON.parse(String(init?.body)).items as Array<{
            resourceId: string;
            variant: string;
          }>;
          return Response.json({
            items: requested.map(({ resourceId }) => ({
              resourceId,
              variant: "original",
              url: `https://download.test/${resourceId}/original`,
              expiresAt: Date.now() + 60_000,
              mimeType: "image/jpeg",
            })),
          });
        }
        return new Response(new Blob(["original"], { type: "image/jpeg" }));
      },
    );
    const cache = new MediaCache(store, fetcher, Date.now, 1024 * 1024);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    expect(
      await (await cache.getByResourceId("res_fallback", "display"))?.text(),
    ).toBe("original");
    expect(
      await (await cache.getByResourceId("res_fallback", "original"))?.text(),
    ).toBe("original");

    const downloadCalls = fetcher.mock.calls.filter(
      ([input]) => !String(input).endsWith("/api/resources/access"),
    );
    expect(downloadCalls).toHaveLength(1);
  });

  it("coalesces concurrent requested and actual fallback variants", async () => {
    const store = createMemoryStore();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/resources/access")) {
          const requested = JSON.parse(String(init?.body)).items as Array<{
            resourceId: string;
          }>;
          return Response.json({
            items: requested.map(({ resourceId }) => ({
              resourceId,
              variant: "original",
              url: `https://download.test/${resourceId}/original`,
              expiresAt: Date.now() + 60_000,
              mimeType: "video/mp4",
            })),
          });
        }
        return new Response(new Blob(["video"], { type: "video/mp4" }));
      },
    );
    const cache = new MediaCache(store, fetcher, Date.now, 1024 * 1024);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    const [display, original] = await Promise.all([
      cache.getByResourceId("res_video", "display"),
      cache.getByResourceId("res_video", "original"),
    ]);

    expect(await display?.text()).toBe("video");
    expect(await original?.text()).toBe("video");
    expect(
      fetcher.mock.calls.filter(
        ([input]) => !String(input).endsWith("/api/resources/access"),
      ),
    ).toHaveLength(1);
  });

  it("downloads distinct display and original variants once each", async () => {
    const store = createMemoryStore();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/resources/access")) {
          const requested = JSON.parse(String(init?.body)).items as Array<{
            resourceId: string;
            variant: "display" | "original";
          }>;
          return Response.json({
            items: requested.map(({ resourceId, variant }) => ({
              resourceId,
              variant,
              url: `https://download.test/${resourceId}/${variant}`,
              expiresAt: Date.now() + 60_000,
              mimeType: "image/webp",
            })),
          });
        }
        const variant = String(input).endsWith("/original")
          ? "original"
          : "display";
        return new Response(new Blob([variant], { type: "image/webp" }));
      },
    );
    const cache = new MediaCache(store, fetcher, Date.now, 1024 * 1024);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    await cache.getByResourceId("res_image", "display");
    await cache.getByResourceId("res_image", "original");
    await cache.getByResourceId("res_image", "original");

    expect(
      fetcher.mock.calls.filter(
        ([input]) => !String(input).endsWith("/api/resources/access"),
      ),
    ).toHaveLength(2);
  });

  it("serves a just-completed blob while persistence is still pending", async () => {
    let releasePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const store: MediaCacheStore = {
      ...emptyStore,
      put: async () => persistence,
    };
    const fetcher = vi.fn(mediaFetcher());
    const cache = new MediaCache(store, fetcher, Date.now, 1024 * 1024);
    cache.configure({ userId: "user_1", getAccessToken: async () => "token" });

    const writing = cache.putByResourceId(
      "res_voice",
      new Blob(["cached voice"], { type: "audio/mpeg" }),
    );
    expect(await (await cache.getByResourceId("res_voice", "original"))?.text()).toBe(
      "cached voice",
    );
    expect(fetcher).not.toHaveBeenCalled();

    releasePersistence();
    await writing;
  });
});

function createMemoryStore(): MediaCacheStore {
  const records = new Map<string, CachedMediaEntry>();
  return {
    ...emptyStore,
    get: async (key) => records.get(key),
    put: async (key, response, metadata) => {
      records.set(key, { response, metadata });
    },
  };
}

function mediaFetcher(downloadReady: Promise<void> = Promise.resolve()) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/resources/access"))
      return new Response(
        JSON.stringify({
          items: [
            {
              resourceId: "res_shared",
              variant: "display",
              url: "https://download.test/res_shared",
              expiresAt: Date.now() + 60_000,
              mimeType: "image/jpeg",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    await downloadReady;
    return new Response(new Blob(["media"], { type: "image/jpeg" }), {
      status: 200,
    });
  });
}
