import {
  ChatCircleDots,
  GearSix,
  Heart,
  NotePencil,
  PencilSimple,
  Robot,
  UploadSimple,
  Archive,
} from "@phosphor-icons/react";
import type { Agent, CharacterAssetDraft } from "@echoo/shared";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";
import { useState } from "react";

const posts = [
  {
    title: "关于本初角色记忆的三条边界",
    body: "长期记忆应该服务于关系，而不是复制聊天记录。",
    likes: "812",
    replies: "34",
  },
  {
    title: "我为什么喜欢切片角色",
    body: "它像一段短促但准确的共鸣，不需要承担完整人格。",
    likes: "509",
    replies: "21",
  },
];

export function ProfilePage({
  agents,
  isLoadingAgents,
  onOpenAgent,
  onOpenSettings,
  publicAssets,
  onCreatePublicDraft,
  onManagePublicAsset,
  onUnlistAsset,
}: {
  agents: Agent[];
  isLoadingAgents: boolean;
  onOpenAgent: (agent: Agent) => void;
  onOpenSettings: () => void;
  publicAssets: CharacterAssetDraft[];
  onCreatePublicDraft: (agentId: string) => Promise<void>;
  onManagePublicAsset: (asset: CharacterAssetDraft) => void;
  onUnlistAsset: (agentId: string, assetId: string) => Promise<void>;
}) {
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const cards = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    kind: formatAgentType(agent),
    description: agent.introduction || getAgentFallbackDescription(agent),
    gradient: "from-white/16 via-white/5 to-transparent",
    avatarResourcePath: agent.avatarResourcePath,
    coverResourcePath: agent.coverResourcePath,
    attributes: agent.attributes,
    tags: agent.tags,
    source: agent,
  }));

  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-7 text-center md:p-10">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[110px]" />
        <button
          aria-label="设置"
          className="absolute right-5 top-5 z-20 grid h-10 w-10 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.06] hover:text-white active:translate-y-px"
          type="button"
          onClick={onOpenSettings}
        >
          <GearSix size={20} weight="duotone" />
        </button>
        <div className="relative z-10 flex flex-col items-center">
          <div className="grid h-36 w-36 place-items-center rounded-full border border-white/18 bg-white/[0.05] shadow-[0_0_48px_rgba(255,255,255,0.12)] md:h-40 md:w-40">
            <Robot size={72} weight="thin" className="text-white" />
          </div>
          <h1 className="mt-6 text-4xl font-semibold text-white md:text-5xl">
            Aether
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">
            一个正在共创角色的人。偏好安静、连续、带长期记忆的会话体验。
          </p>
          <div className="mt-7 grid w-full max-w-2xl grid-cols-3 border-y border-white/10 py-5">
            {[
              [String(agents.length), "角色"],
              [
                String(
                  agents.filter((agent) => agent.type === "prime-figure")
                    .length,
                ),
                "本初角色",
              ],
              [
                String(
                  agents.filter((agent) => agent.type === "slice-figure")
                    .length,
                ),
                "切片角色",
              ],
            ].map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-semibold text-white">{value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/38">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] active:scale-95">
              <PencilSimple size={17} />
              编辑资料
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-full p-1.5">
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-full bg-white py-3 text-sm font-medium text-[#09090b]">
            创作
          </button>
          <button className="rounded-full py-3 text-sm font-medium text-white/55 transition hover:text-white">
            动态
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">我的角色</h2>
            <span className="text-sm text-white/40">本初角色与切片角色</span>
          </div>
          {publishNotice ? (
            <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-white/55">
              {publishNotice}
            </p>
          ) : null}
          {isLoadingAgents ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-sm text-white/45">
              正在加载角色……
            </div>
          ) : cards.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2">
              {cards.map((agent) => (
                <div key={agent.id} className="space-y-2">
                  <CharacterCard
                    agent={agent}
                    onOpenChat={() => onOpenAgent(agent.source)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyAgentId === agent.id}
                      onClick={async () => {
                        setBusyAgentId(agent.id);
                        setPublishNotice(null);
                        try {
                          await onCreatePublicDraft(agent.id);
                        } catch (error) {
                          setPublishNotice(
                            error instanceof Error
                              ? error.message
                              : "发布失败。",
                          );
                        } finally {
                          setBusyAgentId(null);
                        }
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-xs text-white/65 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                    >
                      <UploadSimple size={15} />
                      {publicAssets.some(
                        (asset) => asset.sourceAgentId === agent.id,
                      )
                        ? "管理公共版本"
                        : "创建公共版本"}
                    </button>
                    {agent.source.isPublic && agent.source.publishedAssetId ? (
                      <button
                        type="button"
                        disabled={busyAgentId === agent.id}
                        onClick={async () => {
                          setBusyAgentId(agent.id);
                          try {
                            await onUnlistAsset(
                              agent.id,
                              agent.source.publishedAssetId!,
                            );
                            setPublishNotice(
                              "角色资产已下架，已有添加不受影响。",
                            );
                          } catch (error) {
                            setPublishNotice(
                              error instanceof Error
                                ? error.message
                                : "下架失败。",
                            );
                          } finally {
                            setBusyAgentId(null);
                          }
                        }}
                        className="grid w-11 place-items-center rounded-xl border border-white/10 text-white/42 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                        aria-label="下架角色资产"
                      >
                        <Archive size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-sm leading-6 text-white/50">
              你还没有创建任何角色。创建一个切片角色即可开始新的会话。
            </div>
          )}

          <div className="mb-5 mt-12 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">我的公共角色</h2>
            <span className="text-sm text-white/40">独立草稿与公开版本</span>
          </div>
          {publicAssets.length ? (
            <div className="space-y-3">
              {publicAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onManagePublicAsset(asset)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-left transition hover:bg-white/[0.05]"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-white/[0.06] text-sm font-semibold text-white/75">
                    {asset.snapshot.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {asset.snapshot.name}
                    </p>
                    <p className="mt-1 text-xs text-white/38">
                      {asset.status === "published"
                        ? `已发布 · v${asset.latestVersionNumber}`
                        : asset.status === "unlisted"
                          ? "已下架"
                          : "未发布草稿"}
                      {asset.hasUnpublishedChanges ? " · 有未发布修改" : ""}
                    </p>
                  </div>
                  <NotePencil size={18} className="text-white/35" />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/42">
              从上方任一本地角色创建公共版本后，会先进入独立草稿编辑器。
            </div>
          )}
        </div>
        <aside className="glass-panel h-fit rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
              <NotePencil size={21} weight="duotone" />
            </div>
            <div>
              <h2 className="font-semibold text-white">近期动态</h2>
              <p className="text-xs text-white/40">创作笔记与思考</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {posts.map((post) => (
              <article
                key={post.title}
                className="rounded-xl border border-white/8 bg-white/[0.025] p-4"
              >
                <h3 className="text-sm font-medium leading-5 text-white">
                  {post.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-white/45">
                  {post.body}
                </p>
                <div className="mt-3 flex items-center gap-4 text-xs text-white/38">
                  <span className="flex items-center gap-1.5">
                    <Heart size={14} />
                    {post.likes}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ChatCircleDots size={14} />
                    {post.replies}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function formatAgentType(agent: Agent) {
  if (agent.type === "slice-figure") return "切片角色";
  if (agent.type === "prime-world") return "本初世界";
  return "本初角色";
}

function getAgentFallbackDescription(agent: Agent) {
  return agent.type === "slice-figure" ? agent.detail.persona : "";
}
