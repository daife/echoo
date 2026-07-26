import {
  ArrowClockwise,
  ChatCircleDots,
  DownloadSimple,
  Heart,
} from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import type { PublicAssetSummary } from "@echoo/shared/public-assets";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import { MediaAsset } from "../../features/media/MediaAsset";
import { BackButton } from "../../shared/components/BackButton";
import { LinkedText } from "../../shared/components/LinkedText";
import { ShareButton } from "../../shared/components/ShareButton";
import type { PublicAssetService } from "../../services/PublicAssetService";
import type { SocialService } from "../../services/SocialService";
import {
  PRIME_FIGURE_UPDATE_WARNING,
  assetTypeLabel,
  requiresPrimeFigureUpdateWarning,
} from "../explore/ExplorePage";
import { SocialComments } from "./SocialComments";
import { patchAssetInSocialCaches } from "./socialQueryCache";

export function CharacterDetailPage({
  assetId,
  characterService,
  socialService,
  isAuthenticated,
  onRequireAuth,
  onBack,
  onOpenUser,
  onOpenPost,
  onOpenAsset,
  onAgentInstalled,
  viewerId,
}: {
  assetId: string;
  characterService: PublicAssetService;
  socialService: SocialService;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onBack: () => void;
  onOpenUser: (userId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onAgentInstalled: (agent: Agent) => void;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
  const [asset, setAsset] = useState<PublicAssetSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [worldUpdateOpen, setWorldUpdateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(
    () => {
      if (!busy) setWorldUpdateOpen(false);
    },
    {
      enabled: worldUpdateOpen,
      priority: BACK_HANDLER_PRIORITY.dialog,
    },
  );
  useEffect(() => {
    let cancelled = false;
    void characterService
      .get(assetId)
      .then((value) => {
        if (!cancelled) setAsset(value);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "角色加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, characterService]);

  if (!asset)
    return (
      <section className="mx-auto max-w-4xl pb-24">
        <BackButton className="mb-6" onClick={onBack} />
        <div className="rounded-2xl border border-white/8 bg-[#111114] py-20 text-center text-sm text-white/40">
          {error ?? "正在加载公共创作……"}
        </div>
      </section>
    );
  const snapshot = asset.snapshot;
  const applyAsset = async (strategy?: "preserve-compatible" | "reset") => {
    setWorldUpdateOpen(false);
    setBusy(true);
    setError(null);
    try {
      const result = asset.installedVersionId
        ? await characterService.updateInstallation(asset.id, false, strategy)
        : await characterService.install(asset.id, false);
      onAgentInstalled(result.agent);
      setAsset({
        ...asset,
        installedVersionId: result.installedVersionId,
        updateAvailable: false,
      });
      patchAssetInSocialCaches(queryClient, viewerId, asset.id, {
        installedVersionId: result.installedVersionId,
        updateAvailable: false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加创作失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mx-auto max-w-4xl pb-24">
      <BackButton className="mb-6" onClick={onBack} />
      <article className="overflow-hidden rounded-2xl border border-white/8 bg-[#111114]">
        <div className="relative min-h-80 overflow-hidden bg-[#18171d]">
          {snapshot.coverResourcePath ? (
            <MediaAsset
              mediaUrl={snapshot.coverResourcePath}
              variant="display"
              alt=""
              containerClassName="absolute inset-0"
              className="h-full w-full object-cover opacity-50"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-black/15 to-transparent" />
          <span className="absolute left-7 top-7 flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-xs text-white/65 md:left-10 md:top-10">
            v{asset.latestVersionNumber} · {assetTypeLabel(snapshot.type)}
          </span>
          <div className="relative flex min-h-80 items-end gap-5 p-7 md:p-10">
            <div className="h-24 w-24 overflow-hidden rounded-full border border-white/20 bg-white/5">
              {snapshot.avatarResourcePath ? (
                <MediaAsset
                  mediaUrl={snapshot.avatarResourcePath}
                  variant="thumb"
                  alt={snapshot.name}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div>
              <h1 className="text-4xl font-semibold text-white">
                {snapshot.name}
              </h1>
              <button
                type="button"
                onClick={() => onOpenUser(asset.author.id)}
                className="mt-2 text-sm text-white/45 hover:text-white"
              >
                由 {asset.author.displayName} 发布
              </button>
            </div>
          </div>
        </div>
        <div className="p-7 md:p-10">
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/62">
            <LinkedText
              text={
                snapshot.introduction ||
                (snapshot.type === "prime-world"
                  ? (snapshot.detail.presentation.startView.title ??
                    snapshot.name)
                  : snapshot.detail.persona)
              }
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
            />
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {snapshot.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/8 px-3 py-1 text-xs text-white/40"
              >
                #{tag}
              </span>
            ))}
          </div>
          <div className="mt-7 flex items-center gap-5 border-y border-white/8 py-5">
            <button
              type="button"
              onClick={async () => {
                if (!isAuthenticated) return onRequireAuth();
                const liked = !asset.viewerHasLiked;
                setAsset({
                  ...asset,
                  viewerHasLiked: liked,
                  likeCount: Math.max(0, asset.likeCount + (liked ? 1 : -1)),
                });
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
                  setAsset((current) =>
                    current ? { ...current, ...result } : current,
                  );
                } catch {
                  setAsset(asset);
                  patchAssetInSocialCaches(queryClient, viewerId, asset.id, {
                    viewerHasLiked: asset.viewerHasLiked,
                    likeCount: asset.likeCount,
                    commentCount: asset.commentCount,
                  });
                }
              }}
              aria-label={asset.viewerHasLiked ? "取消点赞" : "点赞"}
              className={`flex min-h-10 items-center gap-2 rounded-lg px-2 -mx-2 text-sm transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98] ${asset.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/45"}`}
            >
              <Heart
                size={19}
                weight={asset.viewerHasLiked ? "fill" : "regular"}
              />
              {asset.likeCount}
            </button>
            <button
              type="button"
              onClick={() => {
                document.getElementById("social-comments")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              aria-label="查看评论"
              className="flex min-h-10 items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-white/38 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98]"
            >
              <ChatCircleDots size={19} />
              {asset.commentCount}
            </button>
            <ShareButton
              target={{ type: "card", id: asset.id }}
              title={snapshot.name}
              text={snapshot.introduction.slice(0, 120)}
            />
            <button
              type="button"
              disabled={
                busy ||
                Boolean(asset.installedVersionId && !asset.updateAvailable)
              }
              onClick={async () => {
                if (!isAuthenticated) return onRequireAuth();
                if (
                  requiresPrimeFigureUpdateWarning(asset) &&
                  !window.confirm(PRIME_FIGURE_UPDATE_WARNING)
                )
                  return;
                if (
                  asset.snapshot.type === "prime-world" &&
                  asset.installedVersionId
                ) {
                  setWorldUpdateOpen(true);
                  return;
                }
                await applyAsset();
              }}
              className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-black disabled:bg-white/10 disabled:text-white/35"
            >
              {asset.updateAvailable ? (
                <ArrowClockwise size={16} />
              ) : (
                <DownloadSimple size={16} />
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
          <div id="social-comments" className="mt-7">
            {error ? (
              <p className="mb-4 text-xs text-red-200/80">{error}</p>
            ) : null}
            <SocialComments
              objectId={asset.id}
              service={socialService}
              isAuthenticated={isAuthenticated}
              onRequireAuth={onRequireAuth}
              onCountChange={(delta) => {
                setAsset((current) =>
                  current
                    ? {
                        ...current,
                        commentCount: Math.max(0, current.commentCount + delta),
                      }
                    : current,
                );
                patchAssetInSocialCaches(
                  queryClient,
                  viewerId,
                  asset.id,
                  (current) => ({
                    ...current,
                    commentCount: Math.max(0, current.commentCount + delta),
                  }),
                );
              }}
              onOpenUser={onOpenUser}
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
            />
          </div>
        </div>
      </article>
      {worldUpdateOpen && snapshot.type === "prime-world" ? (
        <WorldUpdateDialog
          compatibility={asset.worldProgressCompatibility}
          busy={busy}
          onSelect={(strategy) => void applyAsset(strategy)}
          onClose={() => setWorldUpdateOpen(false)}
        />
      ) : null}
    </section>
  );
}

export function WorldUpdateDialog({
  compatibility,
  busy,
  onSelect,
  onClose,
}: {
  compatibility?: { canPreserve: boolean; reason?: string };
  busy: boolean;
  onSelect: (strategy: "preserve-compatible" | "reset") => void;
  onClose: () => void;
}) {
  return (
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-update-title"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111114] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.58)]"
      >
        <h2
          id="world-update-title"
          className="text-xl font-semibold text-white"
        >
          更新本初世界
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/48">
          请选择新版本如何处理当前进度。更新期间世界不能有正在排队或运行的回合。
        </p>
        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled={!compatibility?.canPreserve || busy}
            onClick={() => onSelect("preserve-compatible")}
            className="w-full rounded-xl border border-white/12 p-4 text-left transition hover:border-white/24 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <span className="block text-sm font-medium text-white">
              保留兼容进度
            </span>
            <span className="mt-1 block text-xs leading-5 text-white/42">
              保留变量、世界历史和摘要；切换到新版起始视图，并清理旧定时器与运行中间数据。
            </span>
          </button>
          {!compatibility?.canPreserve ? (
            <p className="rounded-xl border border-amber-300/15 bg-amber-200/[0.05] px-4 py-3 text-xs leading-5 text-amber-100/70">
              {compatibility?.reason ??
                "无法确认当前进度与新版本兼容，只能重置进度。"}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onSelect("reset")}
            className="w-full rounded-xl border border-white/12 p-4 text-left transition hover:border-white/24 disabled:opacity-35"
          >
            <span className="block text-sm font-medium text-white">
              重置进度
            </span>
            <span className="mt-1 block text-xs leading-5 text-white/42">
              使用新版初始状态和起始视图，清空世界历史、摘要、定时器和运行记录。
            </span>
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="mt-5 w-full rounded-full border border-white/10 py-2.5 text-sm text-white/55 hover:text-white disabled:opacity-35"
        >
          取消
        </button>
      </div>
    </div>
  );
}
