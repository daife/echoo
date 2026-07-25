import type { SocialPostSummary } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  filterPublicAssets,
  flattenSocialPages,
  patchAssetInSocialCaches,
  patchPostInSocialCaches,
  removePostFromSocialCaches,
  socialQueryKeys,
  type SocialInfiniteData,
} from "./socialQueryCache";

function post(id: string, likeCount = 0) {
  return { id, likeCount, viewerHasLiked: false } as SocialPostSummary;
}

function asset(id: string, commentCount = 0) {
  return { id, commentCount } as PublicAssetListItem;
}

describe("social query cache", () => {
  it("patches a post in every post list without touching asset lists", () => {
    const client = new QueryClient();
    const followingKey = socialQueryKeys.followingPosts("viewer-1");
    const userKey = socialQueryKeys.userPosts("author-1", "viewer-1");
    const assetKey = socialQueryKeys.followingAssets("viewer-1");
    client.setQueryData(followingKey, infinite([post("post-1")]));
    client.setQueryData(
      userKey,
      infinite([post("post-1"), post("post-2")]),
    );
    client.setQueryData(assetKey, infinite([asset("asset-1", 3)]));

    patchPostInSocialCaches(client, "viewer-1", "post-1", {
      likeCount: 4,
      viewerHasLiked: true,
    });

    expect(
      client.getQueryData<SocialInfiniteData<SocialPostSummary>>(followingKey)
        ?.pages[0]?.items[0],
    ).toMatchObject({ likeCount: 4, viewerHasLiked: true });
    expect(
      client.getQueryData<SocialInfiniteData<SocialPostSummary>>(userKey)
        ?.pages[0]?.items[0],
    ).toMatchObject({ likeCount: 4, viewerHasLiked: true });
    expect(
      client.getQueryData<SocialInfiniteData<PublicAssetListItem>>(assetKey)
        ?.pages[0]?.items[0]?.commentCount,
    ).toBe(3);
  });

  it("removes deleted posts from all cached feeds", () => {
    const client = new QueryClient();
    const firstKey = socialQueryKeys.followingPosts("viewer-1");
    const secondKey = socialQueryKeys.userPosts("author-1", "viewer-1");
    for (const key of [firstKey, secondKey])
      client.setQueryData(key, infinite([post("post-1"), post("post-2")]));

    removePostFromSocialCaches(client, "viewer-1", "post-1");

    expect(
      client
        .getQueryData<SocialInfiniteData<SocialPostSummary>>(firstKey)
        ?.pages.flatMap((page) => page.items.map((item) => item.id)),
    ).toEqual(["post-2"]);
    expect(
      client
        .getQueryData<SocialInfiniteData<SocialPostSummary>>(secondKey)
        ?.pages.flatMap((page) => page.items.map((item) => item.id)),
    ).toEqual(["post-2"]);
  });

  it("patches assets across filters while keeping viewer caches isolated", () => {
    const client = new QueryClient();
    const viewerOneKey = socialQueryKeys.userAssets(
      "author-1",
      "viewer-1",
    );
    const viewerTwoKey = socialQueryKeys.userAssets(
      "author-1",
      "viewer-2",
    );
    client.setQueryData(viewerOneKey, infinite([asset("asset-1")]));
    client.setQueryData(viewerTwoKey, infinite([asset("asset-1")]));

    patchAssetInSocialCaches(client, "viewer-1", "asset-1", {
      commentCount: 2,
    });

    expect(
      client.getQueryData<SocialInfiniteData<PublicAssetListItem>>(viewerOneKey)
        ?.pages[0]?.items[0]?.commentCount,
    ).toBe(2);
    expect(
      client.getQueryData<SocialInfiniteData<PublicAssetListItem>>(viewerTwoKey)
        ?.pages[0]?.items[0]?.commentCount,
    ).toBe(0);
  });

  it("flattens pages, removes duplicate ids, and filters assets locally", () => {
    const slice = {
      ...asset("asset-1"),
      snapshot: { type: "slice-figure" },
    } as PublicAssetListItem;
    const prime = {
      ...asset("asset-2"),
      snapshot: { type: "prime-figure" },
    } as PublicAssetListItem;
    const data = {
      pages: [
        { items: [slice, prime], nextCursor: "next" },
        { items: [slice] },
      ],
      pageParams: [undefined, "next"],
    } satisfies SocialInfiniteData<PublicAssetListItem>;

    const flattened = flattenSocialPages(data);
    expect(flattened.map((item) => item.id)).toEqual(["asset-1", "asset-2"]);
    expect(filterPublicAssets(flattened, "prime-figure")).toEqual([prime]);
    expect(socialQueryKeys.followingAssets("viewer-1")).toEqual(
      socialQueryKeys.followingAssets("viewer-1"),
    );
  });
});

function infinite<T>(items: T[]): SocialInfiniteData<T> {
  return { pages: [{ items }], pageParams: [undefined] };
}
