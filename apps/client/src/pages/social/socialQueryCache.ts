import type { SocialPostSummary } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import type { QueryClient } from "@tanstack/react-query";

export interface SocialListPage<T> {
  items: T[];
  nextCursor?: string;
}

export const socialQueryKeys = {
  all: ["social-lists"] as const,
  posts: ["social-lists", "posts"] as const,
  assets: ["social-lists", "assets"] as const,
  followingPosts: (viewerId: string) =>
    ["social-lists", "posts", viewerId, "following"] as const,
  followingAssets: (viewerId: string, type: string) =>
    ["social-lists", "assets", viewerId, "following", type] as const,
  userPosts: (userId: string, viewerId: string) =>
    ["social-lists", "posts", viewerId, "user", userId] as const,
  userAssets: (userId: string, viewerId: string, type: string) =>
    ["social-lists", "assets", viewerId, "user", userId, type] as const,
  profile: (userId: string, viewerId: string) =>
    ["social-profile", userId, viewerId] as const,
};

export function patchPostInSocialCaches(
  queryClient: QueryClient,
  viewerId: string,
  postId: string,
  patch:
    | Partial<SocialPostSummary>
    | ((post: SocialPostSummary) => SocialPostSummary),
) {
  queryClient.setQueriesData<SocialListPage<SocialPostSummary>>(
    { queryKey: [...socialQueryKeys.posts, viewerId] },
    (page) =>
      page
        ? {
            ...page,
            items: page.items.map((post) =>
              post.id === postId
                ? typeof patch === "function"
                  ? patch(post)
                  : { ...post, ...patch }
                : post,
            ),
          }
        : page,
  );
}

export function removePostFromSocialCaches(
  queryClient: QueryClient,
  viewerId: string,
  postId: string,
) {
  queryClient.setQueriesData<SocialListPage<SocialPostSummary>>(
    { queryKey: [...socialQueryKeys.posts, viewerId] },
    (page) =>
      page
        ? { ...page, items: page.items.filter((post) => post.id !== postId) }
        : page,
  );
}

export function prependPostToSocialCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  post: SocialPostSummary,
) {
  queryClient.setQueryData<SocialListPage<SocialPostSummary>>(
    queryKey,
    (page) => ({
      ...page,
      items: [
        post,
        ...(page?.items ?? []).filter((item) => item.id !== post.id),
      ],
    }),
  );
}

export function patchAssetInSocialCaches(
  queryClient: QueryClient,
  viewerId: string,
  assetId: string,
  patch:
    | Partial<PublicAssetListItem>
    | ((asset: PublicAssetListItem) => PublicAssetListItem),
) {
  queryClient.setQueriesData<SocialListPage<PublicAssetListItem>>(
    { queryKey: [...socialQueryKeys.assets, viewerId] },
    (page) =>
      page
        ? {
            ...page,
            items: page.items.map((asset) =>
              asset.id === assetId
                ? typeof patch === "function"
                  ? patch(asset)
                  : { ...asset, ...patch }
                : asset,
            ),
          }
        : page,
  );
}
