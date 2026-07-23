import { describe, expect, it, vi } from "vitest";
import { MediaCache, type MediaCacheStore } from "./mediaCache";

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
});
