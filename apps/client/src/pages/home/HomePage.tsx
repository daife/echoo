import { Plus, Sparkle } from "@phosphor-icons/react";
import type { Agent, CharacterAssetSummary } from "@echoo/shared";
import { useEffect, useState } from "react";
import { CharacterCatalog } from "../explore/ExplorePage";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { CharacterAssetService } from "../../services/CharacterAssetService";

export function HomePage({
  service,
  isAuthenticated,
  onCreateAgent,
  onAgentInstalled,
  onRequireAuth,
  onOpenAsset,
  onOpenUser,
}: {
  service: CharacterAssetService;
  isAuthenticated: boolean;
  onCreateAgent: () => void;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const [featured, setFeatured] = useState<CharacterAssetSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void service
      .list({ sort: "quality", limit: 6 })
      .then((page) => {
        if (!cancelled) setFeatured(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [service]);

  return (
    <section className="relative space-y-16 pb-24">
      <header className="relative overflow-hidden border-b border-white/10 pb-12 pt-4">
        <div className="pointer-events-none absolute right-0 top-0 text-[10rem] font-semibold leading-none tracking-[-0.08em] text-white/[0.025] md:text-[15rem]">
          ECHOO
        </div>
        <div className="relative max-w-4xl">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
            <Sparkle size={14} /> Public figures
          </div>
          <h1 className="mt-6 max-w-[13ch] text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white md:text-7xl">
            从添加一个角色开始吧
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-white/48">
            可以直接添加其他创作者制作的角色，也可以点击右下角创建自己的专属角色喔~
          </p>
        </div>
      </header>

      <section>
        <div className="mb-6 flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#aaa0c7]">
              MOST LOVED
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white">
              热门角色
            </h2>
          </div>
        </div>
        {featured.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onOpenAsset(asset.id)}
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
                    <p className="mt-2 line-clamp-2 max-w-lg text-sm leading-6 text-white/48">
                      {asset.snapshot.introduction ||
                        asset.snapshot.detail.persona}
                    </p>
                    <p className="mt-4 text-xs text-white/30">
                      {asset.author.displayName}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
            公开角色正在抵达这里。
          </div>
        )}
      </section>

      <CharacterCatalog
        service={service}
        isAuthenticated={isAuthenticated}
        onAgentInstalled={onAgentInstalled}
        onRequireAuth={onRequireAuth}
        onOpenAsset={onOpenAsset}
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
