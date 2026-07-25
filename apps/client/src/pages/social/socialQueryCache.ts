import type { SocialPostSummary } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

export interface SocialListPage<T> {
  items: T[];
  nextCursor?: string;
}

export type SocialInfiniteData<T> = InfiniteData<
  SocialListPage<T>,
  unknown
>;

export const socialQueryKeys = {
  all: ["social-lists"] as const,
  posts: ["social-lists", "posts"] as const,
  assets: ["social-lists", "assets"] as const,
  catalogAssets: (viewerId: string, query: string) =>
    ["social-lists", "assets", viewerId, "catalog", query] as const,
  followingPosts: (viewerId: string) =>
    ["social-lists", "posts", viewerId, "following"] as const,
  followingAssets: (viewerId: string) =>
    ["social-lists", "assets", viewerId, "following"] as const,
  userPosts: (userId: string, viewerId: string) =>
    ["social-lists", "posts", viewerId, "user", userId] as const,
  userAssets: (userId: string, viewerId: string) =>
    ["social-lists", "assets", viewerId, "user", userId] as const,
  profile: (userId: string, viewerId: string) =>
    ["social-profile", userId, viewerId] as const,
};

export function flattenSocialPages<T extends { id: string }>(
  data: SocialInfiniteData<T> | undefined,
) {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export function filterPublicAssets(
  items: PublicAssetListItem[],
  type: "all" | PublicAssetListItem["snapshot"]["type"],
) {
  return type === "all"
    ? items
    : items.filter((item) => item.snapshot.type === type);
}

export function patchPostInSocialCaches(
  queryClient: QueryClient,
  viewerId: string,
  postId: string,
  patch:
    | Partial<SocialPostSummary>
    | ((post: SocialPostSummary) => SocialPostSummary),
) {
  queryClient.setQueriesData<SocialInfiniteData<SocialPostSummary>>(
    { queryKey: [...socialQueryKeys.posts, viewerId] },
    (data) =>
      mapInfiniteItems(data, (post) =>
        post.id === postId
          ? typeof patch === "function"
            ? patch(post)
            : { ...post, ...patch }
          : post,
      ),
  );
}

export function removePostFromSocialCaches(
  queryClient: QueryClient,
  viewerId: string,
  postId: string,
) {
  queryClient.setQueriesData<SocialInfiniteData<SocialPostSummary>>(
    { queryKey: [...socialQueryKeys.posts, viewerId] },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((post) => post.id !== postId),
            })),
          }
        : data,
  );
}

export function prependPostToSocialCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  post: SocialPostSummary,
) {
  queryClient.setQueryData<SocialInfiniteData<SocialPostSummary>>(
    queryKey,
    (data) => {
      if (!data)
        return { pages: [{ items: [post] }], pageParams: [undefined] };
      const pages = data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.id !== post.id),
      }));
      const firstPage = pages[0] ?? { items: [] };
      pages[0] = { ...firstPage, items: [post, ...firstPage.items] };
      return { ...data, pages };
    },
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
  queryClient.setQueriesData<SocialInfiniteData<PublicAssetListItem>>(
    { queryKey: [...socialQueryKeys.assets, viewerId] },
    (data) =>
      mapInfiniteItems(data, (asset) =>
        asset.id === assetId
          ? typeof patch === "function"
            ? patch(asset)
            : { ...asset, ...patch }
          : asset,
      ),
  );
}

function mapInfiniteItems<T>(
  data: SocialInfiniteData<T> | undefined,
  mapper: (item: T) => T,
) {
  return data
    ? {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map(mapper),
        })),
      }
    : data;
}
