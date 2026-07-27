import { MegaphoneSimple, Plus, Sparkle } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import { useEffect, useState } from "react";
import { PublicAssetCatalog } from "../explore/ExplorePage";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { PublicAssetService } from "../../services/PublicAssetService";
import type { SiteContentService } from "../../services/SiteContentService";
import { MarkdownText } from "../../shared/components/LinkedText";

export function HomePage({
  service,
  siteContentService,
  isAuthenticated,
  onCreateAgent,
  onAgentInstalled,
  onRequireAuth,
  onOpenAsset,
  onOpenPost,
  onOpenUser,
}: {
  service: PublicAssetService;
  siteContentService: SiteContentService;
  isAuthenticated: boolean;
  onCreateAgent: () => void;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
  onOpenAsset: (assetId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const [featured, setFeatured] = useState<PublicAssetListItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setFeaturedLoading(true);
    setFeaturedError(false);
    setFeatured([]);
    void service
      .listFeatured({ limit: 6, signal: controller.signal })
      .then((items) => {
        if (!cancelled) setFeatured(items);
      })
      .catch((reason) => {
        if (
          !cancelled &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        )
          setFeaturedError(true);
      })
      .finally(() => {
        if (!cancelled) setFeaturedLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void siteContentService
      .get({ signal: controller.signal })
      .then((content) => {
        if (!cancelled) setAnnouncement(content.announcement);
      })
      .catch(() => {
        if (!cancelled) setAnnouncement("");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [siteContentService]);

  return (
    <section className="relative space-y-16 pb-24">
      <header className="relative overflow-hidden border-b border-white/10 pb-12 pt-4">
        <div className="pointer-events-none absolute right-0 top-0 text-[10rem] font-semibold leading-none tracking-[-0.08em] text-white/[0.025] md:text-[15rem]">
          ECHOO
        </div>
        <div className="relative max-w-4xl">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
            <Sparkle size={14} /> Public creations
          </div>
          <h1 className="mt-6 max-w-[13ch] text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white md:text-7xl">
            从添加一个角色开始吧
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-white/48">
            可以直接添加其他创作者制作的角色或世界，也可以点击右下角创建自己的专属角色或世界喔~
          </p>
        </div>
      </header>

      {announcement ? (
        <section
          aria-label="平台公告"
          className="rounded-2xl border border-[#aaa0c7]/20 bg-[#aaa0c7]/[0.055] px-6 py-5 md:px-7"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-[#c7b9ed]">
            <MegaphoneSimple size={17} weight="duotone" />
            平台公告
          </div>
          <MarkdownText
            text={announcement}
            onOpenPost={onOpenPost}
            onOpenAsset={onOpenAsset}
            className="mt-4 text-sm leading-7 text-white/68"
          />
        </section>
      ) : null}

      <section>
        <div className="mb-6 flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#aaa0c7]">
              MOST LOVED
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white">
              热门创作
            </h2>
          </div>
        </div>
        {featuredLoading ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
            正在统计最受喜爱的公开创作……
          </div>
        ) : featured.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((asset, index) => (
              <div
                key={asset.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenAsset(asset.id)}
                onKeyDown={(event) => {
                  if ((event.target as HTMLElement).closest?.("a")) return;
                  if (event.key === "Enter" || event.key === " ")
                    onOpenAsset(asset.id);
                }}
                className={`group relative min-h-72 overflow-hidden rounded-2xl border border-white/10 bg-[#101014] p-6 ${index === 0 ? "md:col-span-2" : ""}`}
              >
                {asset.snapshot.coverResourcePath ? (
                  <MediaAsset
                    mediaUrl={asset.snapshot.coverResourcePath}
                    variant="display"
                    alt=""
                    containerClassName="absolute inset-0"
                    className="h-full w-full object-cover opacity-30 transition duration-700 group-hover:scale-[1.03] group-hover:opacity-40"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-[#101014] via-[#101014]/55 to-transparent" />
                <div className="relative flex h-full flex-col justify-between">
                  <span className="w-fit rounded-full border border-white/12 bg-black/20 px-3 py-1 text-[10px] text-white/58 backdrop-blur">
                    v{asset.latestVersionNumber} · {asset.likeCount} 人喜欢
                  </span>
                  <div className="mt-24">
                    <h3 className="text-2xl font-semibold text-white">
                      {asset.snapshot.name}
                    </h3>
                    <MarkdownText
                      text={asset.snapshot.preview}
                      onOpenPost={onOpenPost}
                      onOpenAsset={onOpenAsset}
                      variant="compact"
                      className="mt-2 line-clamp-2 max-w-lg text-sm leading-6 text-white/48"
                    />
                    <p className="mt-4 text-xs text-white/30">
                      {asset.author.displayName}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
            {featuredError
              ? "热门创作暂时加载失败。"
              : "还没有获得点赞的公开创作。"}
          </div>
        )}
      </section>

      <PublicAssetCatalog
        service={service}
        isAuthenticated={isAuthenticated}
        onAgentInstalled={onAgentInstalled}
        onRequireAuth={onRequireAuth}
        onOpenAsset={onOpenAsset}
        onOpenPost={onOpenPost}
        onOpenUser={onOpenUser}
      />

      <button
        type="button"
        aria-label="创建新角色"
        onClick={onCreateAgent}
        className="fixed bottom-24 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-white text-[#09090b] shadow-[0_18px_55px_rgba(255,255,255,0.22)] transition hover:scale-105 active:scale-95 md:bottom-8 md:right-8"
      >
        <Plus size={24} weight="bold" />
      </button>
    </section>
  );
}
