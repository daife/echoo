import {
  ArrowClockwise,
  ChatCircleDots,
  DownloadSimple,
  Heart,
  MagnifyingGlass,
  SealCheck,
} from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { useServices } from "../../app/providers/ServicesProvider";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { PublicAssetService } from "../../services/PublicAssetService";
import { PostCard } from "../social/PostCard";
import { PostComposer } from "../social/PostComposer";
import {
  patchAssetInSocialCaches,
  patchPostInSocialCaches,
  filterPublicAssets,
  flattenSocialPages,
  prependPostToSocialCache,
  socialQueryKeys,
} from "../social/socialQueryCache";

export const PRIME_FIGURE_UPDATE_WARNING =
  "更新本初角色会覆盖当前的角色设定、日程、行程、当前情境、参数值、情绪与关系状态；聊天记录和长期记忆会保留。建议先进入该角色会话，从右上角菜单导出角色 JSON 备份。\n\n仍要更新到最新版吗？";

export function requiresPrimeFigureUpdateWarning(asset: {
  snapshot: { type: Agent["type"] };
  installedVersionId?: string;
  updateAvailable: boolean;
}) {
  return Boolean(
    asset.snapshot.type === "prime-figure" &&
    asset.installedVersionId &&
    asset.updateAvailable,
  );
}

export function PublicAssetCatalog({
  service,
  isAuthenticated,
  onAgentInstalled,
  onRequireAuth,
  onOpenAsset,
  onOpenUser,
}: {
  service: PublicAssetService;
  isAuthenticated: boolean;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser?: (userId: string) => void;
}) {
  const auth = useAuth();
  const { socialService } = useServices();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [assetType, setAssetType] = useState<"all" | Agent["type"]>("all");
  const [debouncedQuery, setDebouncedQuery] = useState<string | null>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const normalizedQuery = useMemo(
    () => normalizeCharacterSearchQuery(query),
    [query],
  );
  const queryInvalid = isCharacterSearchQueryInvalid(normalizedQuery);
  const viewerId = auth.user?.id ?? "anonymous";
  const catalogQueryKey = socialQueryKeys.catalogAssets(
    viewerId,
    debouncedQuery ?? "__invalid__",
  );
  const assetsQuery = useInfiniteQuery({
    queryKey: catalogQueryKey,
    queryFn: ({ pageParam, signal }) =>
      service.list({
        limit: 12,
        q: debouncedQuery || undefined,
        cursor: pageParam,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: debouncedQuery !== null,
    staleTime: 60_000,
  });
  const loadedAssets = flattenSocialPages(assetsQuery.data);
  const assets = filterPublicAssets(loadedAssets, assetType);
  const loading = assetsQuery.isPending && debouncedQuery !== null;
  const error =
    actionError ??
    (assetsQuery.error instanceof Error ? assetsQuery.error.message : null);

  useEffect(() => {
    if (!normalizedQuery) {
      setDebouncedQuery("");
      return;
    }
    if (queryInvalid) {
      setDebouncedQuery(null);
      return;
    }
    return scheduleCharacterSearch(normalizedQuery, setDebouncedQuery);
  }, [normalizedQuery, queryInvalid]);

  return (
    <section className="space-y-7">
      <header className="flex flex-col justify-between gap-5 border-b border-white/8 pb-7 md:flex-row md:items-end">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
            PUBLIC ASSET ARCHIVE
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-white">
            全部已公开创作
          </h2>
        </div>
        <div>
          <label className="input-focus-shell flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
            <MagnifyingGlass size={18} className="text-white/40" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索创作、作者或标签"
              className="min-w-0 bg-transparent text-sm text-white outline-none"
            />
          </label>
          {queryInvalid ? (
            <p className="mt-2 text-xs text-[#c7b9ed]">
              请输入 2 至 50 个字符进行搜索。
            </p>
          ) : null}
        </div>
      </header>
      <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
        {(
          [
            ["all", "全部"],
            ["slice-figure", "切片角色"],
            ["prime-figure", "本初角色"],
            ["prime-world", "本初世界"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setAssetType(value)}
            className={`shrink-0 rounded-full border px-4 py-2 text-xs ${assetType === value ? "border-white bg-white text-black" : "border-white/10 text-white/50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {queryInvalid ? (
        <EmptyState text="请输入至少两个字符开始搜索。" />
      ) : loading ? (
        <EmptyState text="正在整理公共创作档案……" />
      ) : assets.length ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {assets.map((asset) => (
            <PublicAssetCard
              key={asset.id}
              asset={asset}
              busy={busyId === asset.id}
              onOpen={() => onOpenAsset(asset.id)}
              onOpenUser={onOpenUser}
              onToggleLike={async () => {
                if (!isAuthenticated) return onRequireAuth();
                const liked = !asset.viewerHasLiked;
                patchAssetInSocialCaches(queryClient, viewerId, asset.id, {
                  viewerHasLiked: liked,
                  likeCount: Math.max(0, asset.likeCount + (liked ? 1 : -1)),
                });
                try {
                  const result = await socialService.setLiked(asset.id, liked);
                  patchAssetInSocialCaches(
                    queryClient,
                    viewerId,
                    asset.id,
                    result,
                  );
                } catch {
                  patchAssetInSocialCaches(
                    queryClient,
                    viewerId,
                    asset.id,
                    asset,
                  );
                }
              }}
              onInstall={async () => {
                if (!isAuthenticated) return onRequireAuth();
                if (
                  asset.snapshot.type === "prime-world" &&
                  asset.installedVersionId &&
                  asset.updateAvailable
                ) {
                  onOpenAsset(asset.id);
                  return;
                }
                if (
                  requiresPrimeFigureUpdateWarning(asset) &&
                  !window.confirm(PRIME_FIGURE_UPDATE_WARNING)
                )
                  return;
                setBusyId(asset.id);
                try {
                  const result = asset.installedVersionId
                    ? await service.updateInstallation(asset.id, false)
                    : await service.install(asset.id, false);
                  onAgentInstalled(result.agent);
                  patchAssetInSocialCaches(queryClient, viewerId, asset.id, {
                    installedVersionId: result.installedVersionId,
                    updateAvailable: false,
                  });
                } catch (reason) {
                  setActionError(
                    reason instanceof Error ? reason.message : "添加创作失败。",
                  );
                } finally {
                  setBusyId(null);
                }
              }}
            />
          ))}
        </div>
      ) : assetsQuery.hasNextPage && assetType !== "all" ? (
        <EmptyState text="当前已加载内容中暂无此类型，可继续加载更多。" />
      ) : (
        <EmptyState
          text={
            error ??
            (debouncedQuery ? "没有找到匹配的公开创作。" : "还没有公开创作。")
          }
        />
      )}
      {assetsQuery.hasNextPage && !queryInvalid ? (
        <button
          type="button"
          disabled={assetsQuery.isFetchingNextPage}
          onClick={() => void assetsQuery.fetchNextPage()}
          className="w-full rounded-xl border border-white/8 py-3 text-sm text-white/45 hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          {assetsQuery.isFetchingNextPage
            ? "正在加载……"
            : assetsQuery.isFetchNextPageError
              ? "加载失败，点击重试"
              : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}

export function ExplorePage({
  onOpenPost,
  onOpenAsset,
  onOpenUser,
  onAgentInstalled,
  onRequireAuth,
  refreshVersion = 0,
}: {
  onOpenPost: (postId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser: (userId: string) => void;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
  refreshVersion?: number;
}) {
  const auth = useAuth();
  const { socialService, publicAssetService } = useServices();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"creations" | "posts">("creations");
  const [creationType, setCreationType] = useState<"all" | Agent["type"]>(
    "all",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const lastRefreshVersionRef = useRef(refreshVersion);
  const viewerId = auth.user?.id ?? "anonymous";
  const assetsQueryKey = socialQueryKeys.followingAssets(viewerId);
  const postsQueryKey = socialQueryKeys.followingPosts(viewerId);
  const assetsQuery = useInfiniteQuery({
    queryKey: assetsQueryKey,
    queryFn: ({ pageParam }) =>
      publicAssetService.listFollowing({
        limit: 24,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(auth.user) && tab === "creations",
    staleTime: 60_000,
  });
  const postsQuery = useInfiniteQuery({
    queryKey: postsQueryKey,
    queryFn: ({ pageParam }) =>
      socialService.listFollowingPosts({ limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(auth.user) && tab === "posts",
    staleTime: 60_000,
  });
  const visibleAssets = filterPublicAssets(
    flattenSocialPages(assetsQuery.data),
    creationType,
  );
  const posts = flattenSocialPages(postsQuery.data);
  const activeQuery = tab === "creations" ? assetsQuery : postsQuery;
  const loading = activeQuery.isPending;
  const error =
    actionError ??
    (activeQuery.error instanceof Error ? activeQuery.error.message : null);
  const hasNextPage = activeQuery.hasNextPage;

  useEffect(() => {
    if (!auth.user || lastRefreshVersionRef.current === refreshVersion) return;
    lastRefreshVersionRef.current = refreshVersion;
    void queryClient.invalidateQueries({
      queryKey: ["social-lists", "posts", viewerId, "following"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["social-lists", "assets", viewerId, "following"],
    });
  }, [auth.user, queryClient, refreshVersion, viewerId]);

  return (
    <section className="mx-auto max-w-5xl space-y-7 pb-24">
      <header className="border-b border-white/8 pb-7">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
          FOLLOWING
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
          探索
        </h1>
        <p className="mt-4 text-sm leading-6 text-white/45">
          你关注的人发布的作品和动态都在这里
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 rounded-full border border-white/8 bg-white/[0.025] p-1.5">
        <button
          type="button"
          onClick={() => setTab("creations")}
          className={`rounded-full py-3 text-sm ${tab === "creations" ? "bg-white font-medium text-black" : "text-white/50"}`}
        >
          关注创作
        </button>
        <button
          type="button"
          onClick={() => setTab("posts")}
          className={`rounded-full py-3 text-sm ${tab === "posts" ? "bg-white font-medium text-black" : "text-white/50"}`}
        >
          关注动态
        </button>
      </div>
      {tab === "creations" ? (
        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
          {(
            [
              ["all", "全部"],
              ["slice-figure", "切片角色"],
              ["prime-figure", "本初角色"],
              ["prime-world", "本初世界"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setCreationType(value)}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs ${creationType === value ? "border-white bg-white text-black" : "border-white/10 text-white/50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {!auth.user ? (
        <div className="rounded-2xl border border-dashed border-white/12 px-6 py-20 text-center">
          <p className="text-lg text-white/72">登录后查看关注内容</p>
          <p className="mt-2 text-sm text-white/35">
            探索页不会混入全站最新动态。
          </p>
          <button
            type="button"
            onClick={onRequireAuth}
            className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black"
          >
            登录
          </button>
        </div>
      ) : tab === "posts" ? (
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <PostComposer
            service={socialService}
            onSaved={(post) =>
              prependPostToSocialCache(queryClient, postsQueryKey, post)
            }
          />
          {loading ? (
            <EmptyState text="正在加载关注动态……" />
          ) : posts.length ? (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpen={() => onOpenPost(post.id)}
                onOpenUser={onOpenUser}
                onOpenPost={onOpenPost}
                onOpenAsset={onOpenAsset}
                onToggleLike={async () => {
                  const liked = !post.viewerHasLiked;
                  patchPostInSocialCaches(queryClient, viewerId, post.id, {
                    viewerHasLiked: liked,
                    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
                  });
                  try {
                    const result = await socialService.setLiked(post.id, liked);
                    patchPostInSocialCaches(
                      queryClient,
                      viewerId,
                      post.id,
                      result,
                    );
                  } catch {
                    patchPostInSocialCaches(
                      queryClient,
                      viewerId,
                      post.id,
                      post,
                    );
                  }
                }}
              />
            ))
          ) : (
            <EmptyState text={error ?? "你关注的人还没有发布动态。"} />
          )}
        </div>
      ) : loading ? (
        <EmptyState text="正在加载关注创作……" />
      ) : visibleAssets.length ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {visibleAssets.map((asset) => (
            <PublicAssetCard
              key={asset.id}
              asset={asset}
              onOpen={() => onOpenAsset(asset.id)}
              onOpenUser={onOpenUser}
              onToggleLike={async () => {
                const liked = !asset.viewerHasLiked;
                const result = await socialService.setLiked(asset.id, liked);
                patchAssetInSocialCaches(
                  queryClient,
                  viewerId,
                  asset.id,
                  result,
                );
              }}
              onInstall={async () => {
                if (
                  asset.snapshot.type === "prime-world" &&
                  asset.installedVersionId &&
                  asset.updateAvailable
                ) {
                  onOpenAsset(asset.id);
                  return;
                }
                if (
                  requiresPrimeFigureUpdateWarning(asset) &&
                  !window.confirm(PRIME_FIGURE_UPDATE_WARNING)
                )
                  return;
                try {
                  const result = asset.installedVersionId
                    ? await publicAssetService.updateInstallation(
                        asset.id,
                        false,
                      )
                    : await publicAssetService.install(asset.id, false);
                  onAgentInstalled(result.agent);
                  patchAssetInSocialCaches(queryClient, viewerId, asset.id, {
                    installedVersionId: result.installedVersionId,
                    updateAvailable: false,
                  });
                } catch (reason) {
                  setActionError(
                    reason instanceof Error ? reason.message : "添加创作失败。",
                  );
                }
              }}
            />
          ))}
        </div>
      ) : assetsQuery.hasNextPage && creationType !== "all" ? (
        <EmptyState text="当前已加载内容中暂无此类型，可继续加载更多。" />
      ) : (
        <EmptyState text={error ?? "你关注的人还没有发布创作。"} />
      )}
      {auth.user && hasNextPage ? (
        <button
          type="button"
          disabled={activeQuery.isFetchingNextPage}
          onClick={() => void activeQuery.fetchNextPage()}
          className="w-full rounded-xl border border-white/8 py-3 text-sm text-white/45 hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          {activeQuery.isFetchingNextPage
            ? "正在加载……"
            : activeQuery.isFetchNextPageError
              ? "加载失败，点击重试"
              : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}

function PublicAssetCard({
  asset,
  busy = false,
  onOpen,
  onOpenUser,
  onToggleLike,
  onInstall,
}: {
  asset: PublicAssetListItem;
  busy?: boolean;
  onOpen: () => void;
  onOpenUser?: (userId: string) => void;
  onToggleLike: () => void | Promise<void>;
  onInstall: () => void | Promise<void>;
}) {
  const snapshot = asset.snapshot;
  return (
    <article className="overflow-hidden rounded-2xl border border-white/8 bg-[#111114]">
      <button
        type="button"
        onClick={onOpen}
        className="relative block h-60 w-full overflow-hidden bg-[#18171d] text-left"
      >
        {snapshot.coverResourcePath ? (
          <MediaAsset
            mediaUrl={snapshot.coverResourcePath}
            variant="thumb"
            alt=""
            containerClassName="absolute inset-0"
            className="h-full w-full object-cover opacity-50 transition duration-700 hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
        <span className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[10px] text-white/65">
          <SealCheck size={14} />v{asset.latestVersionNumber} ·{" "}
          {assetTypeLabel(snapshot.type)}
        </span>
        <div className="absolute bottom-5 left-6 right-6">
          <h2 className="text-3xl font-semibold text-white">{snapshot.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/52">
            {snapshot.preview}
          </p>
        </div>
      </button>
      <div className="p-5">
        {snapshot.attributes.length || snapshot.tags.length ? (
          <div className="flex flex-wrap gap-2">
            {snapshot.attributes.slice(0, 2).map((attribute) => (
              <span
                key={`${attribute.key}-${attribute.value}`}
                className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-white/55"
              >
                {attribute.key} · {attribute.value}
              </span>
            ))}
            {snapshot.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[#aaa0c7]/25 bg-[#aaa0c7]/[0.08] px-2.5 py-1 text-[11px] text-[#c7b9ed]"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenUser?.(asset.author.id)}
          className="mt-4 text-xs text-white/38 hover:text-white"
        >
          由 {asset.author.displayName} 发布
        </button>
        <div className="mt-5 flex items-center gap-5 border-t border-white/8 pt-4">
          <button
            type="button"
            onClick={() => void onToggleLike()}
            className={`flex items-center gap-2 text-sm ${asset.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/42"}`}
          >
            <Heart
              size={18}
              weight={asset.viewerHasLiked ? "fill" : "regular"}
            />
            {asset.likeCount}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-2 text-sm text-white/42"
          >
            <ChatCircleDots size={18} />
            {asset.commentCount}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              Boolean(asset.installedVersionId && !asset.updateAvailable)
            }
            onClick={() => void onInstall()}
            className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-black disabled:bg-white/10 disabled:text-white/35"
          >
            {asset.updateAvailable ? (
              <ArrowClockwise size={15} />
            ) : (
              <DownloadSimple size={15} />
            )}
            {asset.updateAvailable
              ? "更新"
              : asset.installedVersionId
                ? "已添加"
                : snapshot.type === "prime-world"
                  ? "添加世界"
                  : "添加角色"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function mergeUniquePublicAssets(
  current: PublicAssetListItem[],
  incoming: PublicAssetListItem[],
) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
}

export const CHARACTER_SEARCH_DEBOUNCE_MS = 300;

export function normalizeCharacterSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

export function isCharacterSearchQueryInvalid(query: string) {
  return query.length === 1 || query.length > 50;
}

export function scheduleCharacterSearch(
  query: string,
  onReady: (query: string) => void,
) {
  const timer = globalThis.setTimeout(
    () => onReady(query),
    CHARACTER_SEARCH_DEBOUNCE_MS,
  );
  return () => globalThis.clearTimeout(timer);
}

export function assetTypeLabel(type: PublicAssetListItem["snapshot"]["type"]) {
  return type === "prime-figure"
    ? "本初角色"
    : type === "prime-world"
      ? "本初世界"
      : "切片角色";
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
      {text}
    </div>
  );
}
