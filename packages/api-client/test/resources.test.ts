import { ApiClient } from "../src/client";
import { ResourcesApi } from "../src/resources";

it("falls back to the authenticated API when a direct upload fails", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 200 });
  };

  try {
    const resources = new ResourcesApi(
      new ApiClient({
        baseUrl: "https://api.echoo.test/api",
        getAccessToken: async () => "access-token",
      }),
    );
    await resources.upload(
      {
        resourceId: "res_android",
        status: "pending",
        uploadMethod: "PUT",
        uploadUrl: "https://objects.echoo.test/presigned",
        uploadHeaders: { "Content-Type": "image/jpeg" },
        expiresAt: Date.now() + 60_000,
      },
      new Blob(["jpeg"], { type: "image/jpeg" }),
    );

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe(
      "https://api.echoo.test/api/resources/res_android/content",
    );
    expect(requests[1]?.init?.headers).toEqual({
      "Content-Type": "application/octet-stream",
      Authorization: "Bearer access-token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("does not retry an already proxied upload", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new TypeError("Failed to fetch");
  };

  try {
    const resources = new ResourcesApi(
      new ApiClient({ baseUrl: "https://api.echoo.test/api" }),
    );
    await expect(
      resources.upload(
        {
          resourceId: "res_proxy",
          status: "pending",
          uploadMethod: "PUT",
          uploadUrl: "/api/resources/res_proxy/content",
          uploadHeaders: { "Content-Type": "application/octet-stream" },
          expiresAt: Date.now() + 60_000,
        },
        new Blob(["jpeg"], { type: "image/jpeg" }),
      ),
    ).rejects.toThrow("Failed to fetch");
    expect(requestCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
