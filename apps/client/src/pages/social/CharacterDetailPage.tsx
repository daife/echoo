import {
  ArrowClockwise,
  ArrowLeft,
  DownloadSimple,
  Heart,
} from "@phosphor-icons/react";
import type { Agent, CharacterAssetSummary } from "@echoo/shared";
import { useEffect, useState } from "react";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { CharacterAssetService } from "../../services/CharacterAssetService";
import type { SocialService } from "../../services/SocialService";
import {
  PRIME_FIGURE_UPDATE_WARNING,
  requiresPrimeFigureUpdateWarning,
} from "../explore/ExplorePage";
import { SocialComments } from "./SocialComments";

export function CharacterDetailPage({
  assetId,
  characterService,
  socialService,
  isAuthenticated,
  onRequireAuth,
  onBack,
  onOpenUser,
  onAgentInstalled,
}: {
  assetId: string;
  characterService: CharacterAssetService;
  socialService: SocialService;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onBack: () => void;
  onOpenUser: (userId: string) => void;
  onAgentInstalled: (agent: Agent) => void;
}) {
  const [asset, setAsset] = useState<CharacterAssetSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <div className="py-20 text-center text-sm text-white/40">
        {error ?? "正在加载角色……"}
      </div>
    );
  const snapshot = asset.snapshot;
  return (
    <section className="mx-auto max-w-4xl pb-24">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm text-white/48 hover:text-white"
      >
        <ArrowLeft size={17} />
        返回
      </button>
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
          <p className="text-sm leading-7 text-white/62">
            {snapshot.introduction || snapshot.detail.persona}
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
                try {
                  const result = await socialService.setLiked(asset.id, liked);
                  setAsset((current) =>
                    current ? { ...current, ...result } : current,
                  );
                } catch {
                  setAsset(asset);
                }
              }}
              className={`flex items-center gap-2 text-sm ${asset.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/45"}`}
            >
              <Heart
                size={19}
                weight={asset.viewerHasLiked ? "fill" : "regular"}
              />
              {asset.likeCount}
            </button>
            <span className="text-sm text-white/38">
              {asset.commentCount} 条评论
            </span>
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
                setBusy(true);
                try {
                  const result = asset.installedVersionId
                    ? await characterService.updateInstallation(asset.id, false)
                    : await characterService.install(asset.id, false);
                  onAgentInstalled(result.agent);
                  setAsset({
                    ...asset,
                    installedVersionId: result.installedVersionId,
                    updateAvailable: false,
                  });
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "添加角色失败。",
                  );
                } finally {
                  setBusy(false);
                }
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
                  : "添加角色"}
            </button>
          </div>
          <div className="mt-7">
            {error ? (
              <p className="mb-4 text-xs text-red-200/80">{error}</p>
            ) : null}
            <SocialComments
              objectId={asset.id}
              service={socialService}
              isAuthenticated={isAuthenticated}
              onRequireAuth={onRequireAuth}
              onCountChange={(delta) =>
                setAsset((current) =>
                  current
                    ? {
                        ...current,
                        commentCount: Math.max(0, current.commentCount + delta),
                      }
                    : current,
                )
              }
              onOpenUser={onOpenUser}
            />
          </div>
        </div>
      </article>
    </section>
  );
}
