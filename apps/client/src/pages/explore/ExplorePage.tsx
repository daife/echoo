import {
  ArrowClockwise,
  ChatCircleDots,
  DownloadSimple,
  Heart,
  MagnifyingGlass,
  SealCheck,
} from "@phosphor-icons/react";
import type {
  Agent,
  CharacterAssetSummary,
  SocialPostSummary,
} from "@echoo/shared";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { useServices } from "../../app/providers/ServicesProvider";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { CharacterAssetService } from "../../services/CharacterAssetService";
import { PostCard } from "../social/PostCard";
import { PostComposer } from "../social/PostComposer";

export const PRIME_FIGURE_UPDATE_WARNING =
  "更新本初角色会覆盖当前的角色设定、日程、行程、当前情境、参数值、情绪与关系状态；聊天记录和长期记忆会保留。建议先进入该角色会话，从右上角菜单导出角色 JSON 备份。\n\n仍要更新到最新版吗？";

export function requiresPrimeFigureUpdateWarning(asset: CharacterAssetSummary) {
  return Boolean(
    asset.snapshot.type === "prime-figure" &&
    asset.installedVersionId &&
    asset.updateAvailable,
  );
}

export function CharacterCatalog({
  service,
  isAuthenticated,
  onAgentInstalled,
  onRequireAuth,
  onOpenAsset,
  onOpenUser,
}: {
  service: CharacterAssetService;
  isAuthenticated: boolean;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser?: (userId: string) => void;
}) {
  const { socialService } = useServices();
  const [assets, setAssets] = useState<CharacterAssetSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void service
      .list({ sort: "latest", limit: 24, q: query.trim() || undefined })
      .then((page) => {
        if (!cancelled) {
          setAssets(page.items);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "加载角色失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, service]);

  return (
    <section className="space-y-7">
      <header className="flex flex-col justify-between gap-5 border-b border-white/8 pb-7 md:flex-row md:items-end">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
            PUBLIC CHARACTER ARCHIVE
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-white">
            全部已公开角色
          </h2>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
          <MagnifyingGlass size={18} className="text-white/40" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色、作者或标签"
            className="min-w-0 bg-transparent text-sm text-white outline-none"
          />
        </label>
      </header>
      {loading ? (
        <EmptyState text="正在整理公共角色档案……" />
      ) : assets.length ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {assets.map((asset) => (
            <CharacterAssetCard
              key={asset.id}
              asset={asset}
              busy={busyId === asset.id}
              onOpen={() => onOpenAsset(asset.id)}
              onOpenUser={onOpenUser}
              onToggleLike={async () => {
                if (!isAuthenticated) return onRequireAuth();
                const liked = !asset.viewerHasLiked;
                setAssets((current) =>
                  current.map((item) =>
                    item.id === asset.id
                      ? {
                          ...item,
                          viewerHasLiked: liked,
                          likeCount: Math.max(
                            0,
                            item.likeCount + (liked ? 1 : -1),
                          ),
                        }
                      : item,
                  ),
                );
                try {
                  const result = await socialService.setLiked(asset.id, liked);
                  setAssets((current) =>
                    current.map((item) =>
                      item.id === asset.id ? { ...item, ...result } : item,
                    ),
                  );
                } catch {
                  setAssets((current) =>
                    current.map((item) =>
                      item.id === asset.id ? asset : item,
                    ),
                  );
                }
              }}
              onInstall={async () => {
                if (!isAuthenticated) return onRequireAuth();
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
                  setAssets((current) =>
                    current.map((item) =>
                      item.id === asset.id
                        ? {
                            ...item,
                            installedVersionId: result.installedVersionId,
                            updateAvailable: false,
                          }
                        : item,
                    ),
                  );
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "添加角色失败。",
                  );
                } finally {
                  setBusyId(null);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState text={error ?? "还没有公开角色。"} />
      )}
      {nextCursor ? (
        <button
          type="button"
          onClick={async () => {
            const page = await service.list({
              sort: "latest",
              limit: 24,
              q: query.trim() || undefined,
              cursor: nextCursor,
            });
            setAssets((current) => [...current, ...page.items]);
            setNextCursor(page.nextCursor);
          }}
          className="w-full rounded-xl border border-white/8 py-3 text-sm text-white/45 hover:text-white"
        >
          加载更多
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
}: {
  onOpenPost: (postId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser: (userId: string) => void;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
}) {
  const auth = useAuth();
  const { socialService, characterAssetService } = useServices();
  const [tab, setTab] = useState<"creations" | "posts">("creations");
  const [assets, setAssets] = useState<CharacterAssetSummary[]>([]);
  const [posts, setPosts] = useState<SocialPostSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string>();

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request =
      tab === "creations"
        ? characterAssetService.listFollowing({ limit: 24 })
        : socialService.listFollowingPosts({ limit: 20 });
    void request
      .then((page) => {
        if (cancelled) return;
        if (tab === "creations")
          setAssets((page as { items: CharacterAssetSummary[] }).items);
        else setPosts((page as { items: SocialPostSummary[] }).items);
        setNextCursor((page as { nextCursor?: string }).nextCursor);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "关注内容加载失败。",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, characterAssetService, socialService, tab]);

  return (
    <section className="mx-auto max-w-5xl space-y-7 pb-24">
      <header className="border-b border-white/8 pb-7">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
          FOLLOWING
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
          探索你关注的人
        </h1>
        <p className="mt-4 text-sm leading-6 text-white/45">
          创作与动态分开展示，评论只在详情页加载。
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
              setPosts((current) => [
                post,
                ...current.filter((item) => item.id !== post.id),
              ])
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
                onToggleLike={async () => {
                  const liked = !post.viewerHasLiked;
                  setPosts((current) =>
                    current.map((item) =>
                      item.id === post.id
                        ? {
                            ...item,
                            viewerHasLiked: liked,
                            likeCount: Math.max(
                              0,
                              item.likeCount + (liked ? 1 : -1),
                            ),
                          }
                        : item,
                    ),
                  );
                  try {
                    const result = await socialService.setLiked(post.id, liked);
                    setPosts((current) =>
                      current.map((item) =>
                        item.id === post.id ? { ...item, ...result } : item,
                      ),
                    );
                  } catch {
                    setPosts((current) =>
                      current.map((item) =>
                        item.id === post.id ? post : item,
                      ),
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
      ) : assets.length ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {assets.map((asset) => (
            <CharacterAssetCard
              key={asset.id}
              asset={asset}
              onOpen={() => onOpenAsset(asset.id)}
              onOpenUser={onOpenUser}
              onToggleLike={async () => {
                const liked = !asset.viewerHasLiked;
                const result = await socialService.setLiked(asset.id, liked);
                setAssets((current) =>
                  current.map((item) =>
                    item.id === asset.id ? { ...item, ...result } : item,
                  ),
                );
              }}
              onInstall={async () => {
                if (
                  requiresPrimeFigureUpdateWarning(asset) &&
                  !window.confirm(PRIME_FIGURE_UPDATE_WARNING)
                )
                  return;
                try {
                  const result = asset.installedVersionId
                    ? await characterAssetService.updateInstallation(
                        asset.id,
                        false,
                      )
                    : await characterAssetService.install(asset.id, false);
                  onAgentInstalled(result.agent);
                  setAssets((current) =>
                    current.map((item) =>
                      item.id === asset.id
                        ? {
                            ...item,
                            installedVersionId: result.installedVersionId,
                            updateAvailable: false,
                          }
                        : item,
                    ),
                  );
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "添加角色失败。",
                  );
                }
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState text={error ?? "你关注的人还没有发布创作。"} />
      )}
      {auth.user && nextCursor ? (
        <button
          type="button"
          onClick={async () => {
            const page =
              tab === "creations"
                ? await characterAssetService.listFollowing({
                    limit: 24,
                    cursor: nextCursor,
                  })
                : await socialService.listFollowingPosts({
                    limit: 20,
                    cursor: nextCursor,
                  });
            if (tab === "creations")
              setAssets((current) => [
                ...current,
                ...(page as { items: CharacterAssetSummary[] }).items,
              ]);
            else
              setPosts((current) => [
                ...current,
                ...(page as { items: SocialPostSummary[] }).items,
              ]);
            setNextCursor(page.nextCursor);
          }}
          className="w-full rounded-xl border border-white/8 py-3 text-sm text-white/45 hover:text-white"
        >
          加载更多
        </button>
      ) : null}
    </section>
  );
}

function CharacterAssetCard({
  asset,
  busy = false,
  onOpen,
  onOpenUser,
  onToggleLike,
  onInstall,
}: {
  asset: CharacterAssetSummary;
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
            variant="display"
            alt=""
            containerClassName="absolute inset-0"
            className="h-full w-full object-cover opacity-50 transition duration-700 hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
        <span className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[10px] text-white/65">
          <SealCheck size={14} />v{asset.latestVersionNumber} · {characterTypeLabel(snapshot.type)}
        </span>
        <div className="absolute bottom-5 left-6 right-6">
          <h2 className="text-3xl font-semibold text-white">{snapshot.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/52">
            {truncatePreviewText(snapshot.introduction || snapshot.detail.persona)}
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
                : "添加角色"}
          </button>
        </div>
      </div>
    </article>
  );
}

function truncatePreviewText(text: string, maxLength = 72) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}…`
    : normalized;
}

export function characterTypeLabel(
  type: CharacterAssetSummary["snapshot"]["type"],
) {
  return type === "prime-figure" ? "本初角色" : "切片角色";
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
      {text}
    </div>
  );
}
