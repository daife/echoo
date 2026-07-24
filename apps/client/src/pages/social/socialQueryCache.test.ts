import type { SocialPostSummary } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  patchAssetInSocialCaches,
  patchPostInSocialCaches,
  removePostFromSocialCaches,
  socialQueryKeys,
  type SocialListPage,
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
    const assetKey = socialQueryKeys.followingAssets("viewer-1", "all");
    client.setQueryData<SocialListPage<SocialPostSummary>>(followingKey, {
      items: [post("post-1")],
    });
    client.setQueryData<SocialListPage<SocialPostSummary>>(userKey, {
      items: [post("post-1"), post("post-2")],
    });
    client.setQueryData<SocialListPage<PublicAssetListItem>>(assetKey, {
      items: [asset("asset-1", 3)],
    });

    patchPostInSocialCaches(client, "viewer-1", "post-1", {
      likeCount: 4,
      viewerHasLiked: true,
    });

    expect(
      client.getQueryData<SocialListPage<SocialPostSummary>>(followingKey)
        ?.items[0],
    ).toMatchObject({ likeCount: 4, viewerHasLiked: true });
    expect(
      client.getQueryData<SocialListPage<SocialPostSummary>>(userKey)?.items[0],
    ).toMatchObject({ likeCount: 4, viewerHasLiked: true });
    expect(
      client.getQueryData<SocialListPage<PublicAssetListItem>>(assetKey)
        ?.items[0]?.commentCount,
    ).toBe(3);
  });

  it("removes deleted posts from all cached feeds", () => {
    const client = new QueryClient();
    const firstKey = socialQueryKeys.followingPosts("viewer-1");
    const secondKey = socialQueryKeys.userPosts("author-1", "viewer-1");
    for (const key of [firstKey, secondKey])
      client.setQueryData<SocialListPage<SocialPostSummary>>(key, {
        items: [post("post-1"), post("post-2")],
      });

    removePostFromSocialCaches(client, "viewer-1", "post-1");

    expect(
      client
        .getQueryData<SocialListPage<SocialPostSummary>>(firstKey)
        ?.items.map((item) => item.id),
    ).toEqual(["post-2"]);
    expect(
      client
        .getQueryData<SocialListPage<SocialPostSummary>>(secondKey)
        ?.items.map((item) => item.id),
    ).toEqual(["post-2"]);
  });

  it("patches assets across filters while keeping viewer caches isolated", () => {
    const client = new QueryClient();
    const viewerOneKey = socialQueryKeys.userAssets(
      "author-1",
      "viewer-1",
      "all",
    );
    const viewerTwoKey = socialQueryKeys.userAssets(
      "author-1",
      "viewer-2",
      "all",
    );
    client.setQueryData<SocialListPage<PublicAssetListItem>>(viewerOneKey, {
      items: [asset("asset-1")],
    });
    client.setQueryData<SocialListPage<PublicAssetListItem>>(viewerTwoKey, {
      items: [asset("asset-1")],
    });

    patchAssetInSocialCaches(client, "viewer-1", "asset-1", {
      commentCount: 2,
    });

    expect(
      client.getQueryData<SocialListPage<PublicAssetListItem>>(viewerOneKey)
        ?.items[0]?.commentCount,
    ).toBe(2);
    expect(
      client.getQueryData<SocialListPage<PublicAssetListItem>>(viewerTwoKey)
        ?.items[0]?.commentCount,
    ).toBe(0);
  });
});
