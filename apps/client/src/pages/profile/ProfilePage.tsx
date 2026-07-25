import {
  GearSix,
  Copy,
  Microphone,
  NotePencil,
  PencilSimple,
  Plus,
  SpinnerGap,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import type {
  Agent,
  AgentResourceUpload,
  UpdateUserProfileRequest,
  UserProfile,
} from "@echoo/shared";
import type {
  CreatePublicAssetDraftRequest,
  PublicAssetDraft,
} from "@echoo/shared/public-assets";
import type { VoiceClone } from "@echoo/shared/voice-clones";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { imageFileToUpload } from "../../shared/utils/imageCompression";
import { useServices } from "../../app/providers/ServicesProvider";
import { audioBlobToMp3 } from "../../features/messages/audio/mp3Recorder";
import { usePushToTalk } from "../../features/messages/usePushToTalk";
import { PostComposer } from "../social/PostComposer";
import { PostCard } from "../social/PostCard";
import { createOptions } from "../create-agent/createAgentOptions";
import {
  flattenSocialPages,
  patchPostInSocialCaches,
  prependPostToSocialCache,
  socialQueryKeys,
} from "../social/socialQueryCache";

export function ProfilePage({
  agents,
  isLoadingAgents,
  onOpenAgent,
  onOpenSettings,
  publicAssets,
  onCreatePublicDraft,
  onManagePublicAsset,
  onOpenAsset,
  onOpenPost,
  onOpenUser,
}: {
  agents: Agent[];
  isLoadingAgents: boolean;
  onOpenAgent: (agent: Agent) => void;
  onOpenSettings: () => void;
  publicAssets: PublicAssetDraft[];
  onCreatePublicDraft: (
    input: CreatePublicAssetDraftRequest,
  ) => Promise<void>;
  onManagePublicAsset: (asset: PublicAssetDraft) => void;
  onOpenAsset: (assetId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const auth = useAuth();
  const { socialService, voiceCloneService } = useServices();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"creations" | "posts">(
    "creations",
  );
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [isPublicCreateOpen, setIsPublicCreateOpen] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [isVoiceCloneCreateOpen, setIsVoiceCloneCreateOpen] = useState(false);
  const [deletingVoiceCloneId, setDeletingVoiceCloneId] = useState<string | null>(null);
  const [voiceCloneNotice, setVoiceCloneNotice] = useState<string | null>(null);
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
    origin: agent.origin,
    source: agent,
  }));
  const originalCards = cards.filter((card) => card.origin.kind === "original");
  const publicAssetCards = cards.filter(
    (card) => card.origin.kind === "public-asset",
  );
  const viewerId = auth.user?.id ?? "anonymous";
  const postsQueryKey = socialQueryKeys.userPosts(viewerId, viewerId);
  const postsQuery = useInfiniteQuery({
    queryKey: postsQueryKey,
    queryFn: ({ pageParam }) =>
      socialService.listUserPosts(viewerId, {
        limit: 20,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(auth.user) && activeTab === "posts",
    staleTime: 60_000,
  });
  const userPosts = flattenSocialPages(postsQuery.data);
  const voiceClonesQueryKey = ["voice-clones", "mine", viewerId] as const;
  const voiceClonesQuery = useQuery({
    queryKey: voiceClonesQueryKey,
    queryFn: () => voiceCloneService.listMine(),
    enabled: Boolean(auth.user),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.some(
        (clone) => clone.state === "created" || clone.state === "training",
      )
        ? 3_000
        : false,
  });
  const voiceClones = voiceClonesQuery.data ?? [];

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
          <IdentityAvatar
            mediaUrl={auth.user?.avatarUrl}
            alt={auth.user ? `${auth.user.displayName}的头像` : "用户头像"}
            variant="display"
            className="h-36 w-36 border-white/18 shadow-[0_0_48px_rgba(255,255,255,0.12)] md:h-40 md:w-40"
            isAdmin={auth.user?.isAdmin}
          />
          <h1 className="mt-6 text-4xl font-semibold text-white md:text-5xl">
            {auth.user?.displayName ?? ""}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">
            {auth.user?.signature || "尚未填写个性签名"}
          </p>
          <div className="mt-7 grid w-full max-w-2xl grid-cols-3 border-y border-white/10 py-5">
            {[
              [String(agents.length), "个人会话"],
              [String(originalCards.length), "原创会话"],
              [String(publicAssetCards.length), "已添加会话"],
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
            <button
              type="button"
              onClick={() => setIsProfileEditorOpen(true)}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <PencilSimple size={17} />
              编辑资料
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-full p-1.5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("creations")}
            className={`rounded-full py-3 text-sm font-medium ${activeTab === "creations" ? "bg-white text-[#09090b]" : "text-white/55"}`}
          >
            创作
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("posts")}
            className={`rounded-full py-3 text-sm font-medium ${activeTab === "posts" ? "bg-white text-[#09090b]" : "text-white/55"}`}
          >
            动态
          </button>
        </div>
      </div>

      <div
        className={`${activeTab === "creations" ? "block" : "hidden"} @container/profile`}
      >
        <div className="grid gap-5 @min-[1100px]/profile:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-white">个人会话</h2>
              <span className="text-sm text-white/40">按来源分组</span>
            </div>
            {publishNotice ? (
              <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-white/55">
                {publishNotice}
              </p>
            ) : null}
            {isLoadingAgents ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-sm text-white/45">
                正在加载个人会话……
              </div>
            ) : (
              <div className="space-y-10">
                <section>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-white">
                      原创会话
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      由你直接创建，可以导入为新的公共创作草稿。
                    </p>
                  </div>
                  {originalCards.length ? (
                    <div className="grid gap-5 @min-[760px]/profile:grid-cols-2">
                      {originalCards.map((agent) => (
                        <CharacterCard
                          key={agent.id}
                          agent={agent}
                          onOpenChat={() => onOpenAgent(agent.source)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm leading-6 text-white/45">
                      还没有原创会话。创建角色后即可开始新的会话。
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-white">
                      从公共创作添加的会话
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      保留原公共创作来源，可查看详情，但不能再次导入发布。
                    </p>
                  </div>
                  {publicAssetCards.length ? (
                    <div className="grid gap-5 @min-[760px]/profile:grid-cols-2">
                      {publicAssetCards.map((agent) => (
                        <CharacterCard
                          key={agent.id}
                          agent={agent}
                          onOpenDetail={() => {
                            if (agent.origin.kind === "public-asset")
                              onOpenAsset(agent.origin.assetId);
                          }}
                          onOpenChat={() => onOpenAgent(agent.source)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm leading-6 text-white/45">
                      还没有从公共创作添加的会话。
                    </div>
                  )}
                </section>
              </div>
            )}

            <div className="mb-5 mt-12 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">我的克隆音色</h2>
                <span className="mt-1 block text-sm text-white/40">
                  最多保留 5 个，可复制 Reference ID 到 TTS 配置
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVoiceCloneNotice(null);
                  setIsVoiceCloneCreateOpen(true);
                }}
                disabled={voiceClones.length >= 5}
                className="flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-[#09090b] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Plus size={16} weight="bold" />
                创建音色克隆
              </button>
            </div>
            {voiceCloneNotice ? (
              <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-white/55">
                {voiceCloneNotice}
              </p>
            ) : null}
            {voiceClonesQuery.isPending ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6 text-sm text-white/45">
                正在加载克隆音色……
              </div>
            ) : voiceClones.length ? (
              <div className="space-y-3">
                {voiceClones.map((clone) => (
                  <div
                    key={clone.id}
                    className="rounded-2xl border border-white/8 bg-white/[0.025] p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70">
                        <Microphone size={20} weight="duotone" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">{clone.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${clone.state === "trained" ? "bg-emerald-400/12 text-emerald-200/75" : clone.state === "failed" ? "bg-red-400/12 text-red-200/75" : "bg-amber-300/12 text-amber-100/70"}`}>
                            {formatVoiceCloneState(clone.state)}
                          </span>
                        </div>
                        {clone.description ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/42">
                            {clone.description}
                          </p>
                        ) : null}
                        <p className="mt-2 break-all font-mono text-[11px] text-white/35">
                          {clone.referenceId}
                        </p>
                        {clone.state !== "trained" && clone.state !== "failed" ? (
                          <p className="mt-1 text-[11px] text-amber-100/55">
                            训练完成前暂不可用于 TTS。
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label={`复制 ${clone.name} 的 Reference ID`}
                          title="复制 Reference ID"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(clone.referenceId);
                              setVoiceCloneNotice("Reference ID 已复制。");
                            } catch {
                              setVoiceCloneNotice("复制失败，请手动选择 Reference ID。");
                            }
                          }}
                          className="grid h-9 w-9 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除克隆音色 ${clone.name}`}
                          title="删除克隆音色"
                          disabled={deletingVoiceCloneId === clone.id}
                          onClick={async () => {
                            if (!window.confirm(`确定删除克隆音色“${clone.name}”吗？该操作也会删除 Fish Audio 上的模型。`)) return;
                            setDeletingVoiceCloneId(clone.id);
                            try {
                              await voiceCloneService.delete(clone.id);
                              queryClient.setQueryData<VoiceClone[]>(
                                voiceClonesQueryKey,
                                (current = []) => current.filter((item) => item.id !== clone.id),
                              );
                              setVoiceCloneNotice("克隆音色已删除。");
                            } catch (reason) {
                              setVoiceCloneNotice(
                                reason instanceof Error ? reason.message : "克隆音色删除失败。",
                              );
                            } finally {
                              setDeletingVoiceCloneId(null);
                            }
                          }}
                          className="grid h-9 w-9 place-items-center rounded-full text-white/35 transition hover:bg-red-400/10 hover:text-red-200 disabled:opacity-30"
                        >
                          {deletingVoiceCloneId === clone.id ? <SpinnerGap size={16} className="animate-spin" /> : <Trash size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm leading-6 text-white/42">
                还没有克隆音色。准备一段 10–90 秒、单人且环境安静的语音即可创建。
              </div>
            )}

            <div className="mb-5 mt-12 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">
                  我的公共创作
                </h2>
                <span className="mt-1 block text-sm text-white/40">
                  独立草稿与公开版本
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPublishNotice(null);
                  setIsPublicCreateOpen(true);
                }}
                className="flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-[#09090b] transition active:scale-95"
              >
                <Plus size={16} weight="bold" />
                创建公共创作
              </button>
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
                还没有公共创作。你可以从空白开始，也可以从原创会话导入初始设定。
              </div>
            )}
          </div>
          <aside className="glass-panel hidden h-fit rounded-2xl p-6 @min-[1100px]/profile:block">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                <NotePencil size={21} weight="duotone" />
              </div>
              <div>
                <h2 className="font-semibold text-white">动态</h2>
                <p className="text-xs text-white/40">
                  在上方切换到动态即可发布与管理
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-white/42">
              列表卡片只显示评论数量。进入动态详情后才会加载评论内容，避免主页过长。
            </p>
          </aside>
        </div>
      </div>
      {activeTab === "posts" ? (
        <div className="mx-auto max-w-3xl space-y-5">
          <PostComposer
            service={socialService}
            onSaved={(post) =>
              prependPostToSocialCache(queryClient, postsQueryKey, post)
            }
          />
          {postsQuery.isPending ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
              正在加载动态……
            </div>
          ) : userPosts.length ? (
            userPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpen={() => onOpenPost(post.id)}
                onOpenUser={onOpenUser}
                onToggleLike={async () => {
                  const result = await socialService.setLiked(
                    post.id,
                    !post.viewerHasLiked,
                  );
                  patchPostInSocialCaches(
                    queryClient,
                    viewerId,
                    post.id,
                    result,
                  );
                }}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
              还没有发布动态。
            </div>
          )}
          {postsQuery.hasNextPage ? (
            <button
              type="button"
              disabled={postsQuery.isFetchingNextPage}
              onClick={() => void postsQuery.fetchNextPage()}
              className="w-full rounded-xl border border-white/8 py-3 text-sm text-white/45 hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {postsQuery.isFetchingNextPage
                ? "正在加载……"
                : postsQuery.isFetchNextPageError
                  ? "加载失败，点击重试"
                  : "加载更多"}
            </button>
          ) : null}
        </div>
      ) : null}
      {isProfileEditorOpen && auth.user ? (
        <ProfileEditorDialog
          user={auth.user}
          onClose={() => setIsProfileEditorOpen(false)}
          onSave={async (input) => {
            await auth.updateProfile(input);
            setIsProfileEditorOpen(false);
          }}
        />
      ) : null}
      {isPublicCreateOpen ? (
        <PublicAssetCreateDialog
          agents={agents}
          onClose={() => setIsPublicCreateOpen(false)}
          onCreate={async (input) => {
            try {
              await onCreatePublicDraft(input);
              setIsPublicCreateOpen(false);
            } catch (error) {
              setPublishNotice(
                error instanceof Error ? error.message : "公共创作创建失败。",
              );
              throw error;
            }
          }}
        />
      ) : null}
      {isVoiceCloneCreateOpen ? (
        <VoiceCloneCreateDialog
          onClose={() => setIsVoiceCloneCreateOpen(false)}
          onCreate={async (input) => {
            const created = await voiceCloneService.create(input);
            queryClient.setQueryData<VoiceClone[]>(voiceClonesQueryKey, (current = []) => [
              created,
              ...current.filter((item) => item.id !== created.id),
            ]);
            setIsVoiceCloneCreateOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

export function PublicAssetCreateDialog({
  agents,
  onClose,
  onCreate,
}: {
  agents: Agent[];
  onClose: () => void;
  onCreate: (input: CreatePublicAssetDraftRequest) => Promise<void>;
}) {
  const eligibleAgents = agents.filter((agent) => agent.origin.kind === "original");
  const [mode, setMode] = useState<"blank" | "import">("blank");
  const [type, setType] = useState<Agent["type"]>(
    "slice-figure",
  );
  const [importFromOriginalAgentId, setImportFromOriginalAgentId] = useState(
    eligibleAgents[0]?.id ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(
    () => {
      if (!isSubmitting) onClose();
    },
    { priority: BACK_HANDLER_PRIORITY.dialog },
  );

  return (
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/65 px-4 backdrop-blur-sm md:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label="创建公共创作"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101014] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.58)]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (mode === "import" && !importFromOriginalAgentId) return;
          setIsSubmitting(true);
          setError(null);
          try {
            await onCreate(
              mode === "blank" ? { type } : { importFromOriginalAgentId },
            );
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "公共创作创建失败。",
            );
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">创建公共创作</h2>
            <p className="mt-1 text-sm leading-6 text-white/42">
              公共创作独立于原创会话，支持角色与本初世界。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭公共创作创建"
            disabled={isSubmitting}
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-full border border-white/8 bg-white/[0.025] p-1.5">
          {(
            [
              ["blank", "从空白创建"],
              ["import", "从原创会话导入"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-full px-3 py-2.5 text-sm transition ${mode === value ? "bg-white text-black" : "text-white/48 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "blank" ? (
          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-white/72">
              创作类型
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {createOptions.map((option) => {
                const Icon = option.icon;
                const active = type === option.type;
                return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => setType(option.type)}
                  className={`rounded-xl border p-4 text-left transition ${active ? "border-white/24 bg-white/[0.09] text-white" : "border-white/8 text-white/48 hover:border-white/16"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Icon size={20} weight="duotone" />
                    <span className="text-xs">{option.label}</span>
                  </div>
                  <span className="mt-4 block text-sm font-medium text-white">
                    {option.title}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-white/42 sm:hidden">
                    {option.description}
                  </span>
                </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <div className="mt-6">
            <label
              className="text-sm font-medium text-white/72"
              htmlFor="public-import-agent"
            >
              选择原创会话
            </label>
            {eligibleAgents.length ? (
              <select
                id="public-import-agent"
                value={importFromOriginalAgentId}
                onChange={(event) =>
                  setImportFromOriginalAgentId(event.target.value)
                }
                className="mt-3 w-full rounded-xl border border-white/10 bg-[#17171c] px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              >
                {eligibleAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ·{" "}
                    {agent.type === "prime-figure"
                      ? "本初角色"
                      : agent.type === "prime-world"
                        ? "本初世界"
                        : "切片角色"}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-sm leading-6 text-white/42">
                暂无可导入的原创会话。从公共创作添加的会话不能再次发布。
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-white/38">
              只导入创作定义与媒体素材；不会导入消息、运行进度、密钥或会话运行配置。
            </p>
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-red-200/75">{error}</p> : null}
        <button
          type="submit"
          disabled={
            isSubmitting || (mode === "import" && !importFromOriginalAgentId)
          }
          className="mt-6 flex w-full items-center justify-center rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-35"
        >
          {isSubmitting ? "正在创建……" : "创建并进入草稿编辑器"}
        </button>
      </form>
    </div>
  );
}

export function ProfileEditorDialog({
  user,
  onClose,
  onSave,
}: {
  user: UserProfile;
  onClose: () => void;
  onSave: (input: UpdateUserProfileRequest) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [signature, setSignature] = useState(user.signature);
  const [avatar, setAvatar] = useState<AgentResourceUpload | null | undefined>(
    undefined,
  );
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{
    displayName?: string;
    signature?: string;
    avatar?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  useBackHandler(
    () => {
      if (!isSaving) onClose();
    },
    { priority: BACK_HANDLER_PRIORITY.dialog },
  );
  const previewUrl =
    avatar && typeof avatar === "object"
      ? `data:${avatar.mimeType};base64,${avatar.dataBase64}`
      : avatar === null
        ? undefined
        : user.avatarUrl;

  const handleImage = async (file?: File) => {
    if (!file) return;
    setIsProcessingImage(true);
    setFieldError((current) => ({ ...current, avatar: undefined }));
    setSaveError(null);
    try {
      setAvatar(await imageFileToUpload(file));
    } catch (error) {
      setFieldError((current) => ({
        ...current,
        avatar: error instanceof Error ? error.message : "图片处理失败。",
      }));
    } finally {
      setIsProcessingImage(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextDisplayName = displayName.trim();
    const nextSignature = signature.trim();
    const nextErrors: typeof fieldError = {};
    if (!nextDisplayName) nextErrors.displayName = "昵称不能为空。";
    else if (nextDisplayName.length > 80)
      nextErrors.displayName = "昵称不能超过 80 个字符。";
    if (nextSignature.length > 160)
      nextErrors.signature = "个性签名不能超过 160 个字符。";
    if (Object.keys(nextErrors).length) {
      setFieldError(nextErrors);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        displayName: nextDisplayName,
        signature: nextSignature,
        ...(avatar !== undefined ? { avatar } : {}),
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "资料保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/65 px-4 backdrop-blur-sm md:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        className="w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] md:max-h-[92dvh] md:p-7"
        onSubmit={submit}
        aria-label="编辑个人资料"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">编辑资料</h2>
            <p className="mt-1 text-sm leading-6 text-white/42">
              这些信息会用于个人主页和你的会话身份。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭资料编辑"
            disabled={isSaving}
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center">
          <IdentityAvatar
            mediaUrl={previewUrl}
            alt={`${displayName || user.displayName}的头像预览`}
            variant="display"
            className="h-28 w-28 border-white/18 shadow-[0_0_34px_rgba(255,255,255,0.09)]"
            isAdmin={user.isAdmin}
          />
          <div className="mt-4 grid w-full max-w-[17rem] grid-cols-2 gap-2">
            <label className="flex h-10 cursor-pointer items-center justify-center rounded-full bg-white px-4 text-center text-xs font-medium leading-none text-[#09090b] transition active:scale-95 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white">
              {isProcessingImage ? "正在处理…" : "选择图片"}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={isProcessingImage || isSaving}
                onChange={(event) => {
                  void handleImage(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {previewUrl ? (
              <button
                type="button"
                disabled={isProcessingImage || isSaving}
                onClick={() => {
                  setAvatar(null);
                  setFieldError((current) => ({
                    ...current,
                    avatar: undefined,
                  }));
                }}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/10 px-4 text-xs leading-none text-white/58 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
              >
                <Trash size={14} />
                移除头像
              </button>
            ) : null}
          </div>
          {fieldError.avatar ? (
            <p className="mt-2 text-xs text-red-200/80">{fieldError.avatar}</p>
          ) : null}
          <p className="mt-2 text-center text-[11px] leading-5 text-white/30">
            支持 JPEG、PNG、WebP、GIF
          </p>
        </div>

        <div className="mt-7 space-y-5">
          <label className="block">
            <span className="text-xs font-medium text-white/62">昵称</span>
            <input
              type="text"
              value={displayName}
              maxLength={80}
              disabled={isSaving}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setFieldError((current) => ({
                  ...current,
                  displayName: undefined,
                }));
              }}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/25 disabled:opacity-50"
            />
            <span className="mt-1.5 flex justify-between gap-3 text-[11px]">
              <span className="text-red-200/80">{fieldError.displayName}</span>
              <span className="ml-auto tabular-nums text-white/28">
                {displayName.length}/80
              </span>
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-white/62">个性签名</span>
            <textarea
              value={signature}
              maxLength={160}
              rows={4}
              disabled={isSaving}
              placeholder="写下你希望如何被认识"
              onChange={(event) => {
                setSignature(event.target.value);
                setFieldError((current) => ({
                  ...current,
                  signature: undefined,
                }));
              }}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-white/25 disabled:opacity-50"
            />
            <span className="mt-1.5 flex justify-between gap-3 text-[11px]">
              <span className="text-red-200/80">{fieldError.signature}</span>
              <span className="ml-auto tabular-nums text-white/28">
                {signature.length}/160
              </span>
            </span>
          </label>
        </div>

        {saveError ? (
          <p className="mt-4 rounded-xl border border-red-300/15 bg-red-400/[0.06] px-4 py-3 text-sm leading-5 text-red-100/80">
            {saveError}
          </p>
        ) : null}
        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm text-white/52 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSaving || isProcessingImage}
            className="flex min-w-28 items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#09090b] transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-55"
          >
            {isSaving ? (
              <SpinnerGap className="animate-spin" size={16} />
            ) : null}
            {isSaving ? "正在保存" : "保存修改"}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatAgentType(agent: Agent) {
  if (agent.type === "slice-figure") return "切片角色";
  if (agent.type === "prime-world") return "本初世界";
  return "本初角色";
}

function VoiceCloneCreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description: string;
    consentConfirmed: true;
    sample: Blob;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sample, setSample] = useState<{ blob: Blob; durationSeconds: number } | null>(null);
  const [consent, setConsent] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToTalk = usePushToTalk({
    disabled: isSubmitting || isProcessingFile,
    minRecordingSeconds: 10,
    maxRecordingSeconds: 90,
    onError: setError,
    onRecorded: (blob, durationSeconds) => {
      setSample({ blob, durationSeconds });
      setError(null);
    },
  });
  useBackHandler(
    () => {
      if (!isSubmitting) {
        pushToTalk.cancel();
        onClose();
      }
    },
    { priority: BACK_HANDLER_PRIORITY.dialog },
  );

  const handleFile = async (file?: File) => {
    if (!file) return;
    setIsProcessingFile(true);
    setError(null);
    try {
      const normalized = await audioBlobToMp3(file);
      if (normalized.durationSeconds < 10 || normalized.durationSeconds > 90)
        throw new Error("音频时长必须在 10–90 秒之间。");
      setSample(normalized);
    } catch (reason) {
      setSample(null);
      setError(reason instanceof Error ? reason.message : "音频处理失败。");
    } finally {
      setIsProcessingFile(false);
    }
  };

  return (
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/65 px-4 backdrop-blur-sm md:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label="创建音色克隆"
        className="w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#101014] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.58)] md:max-h-[92dvh]"
        onSubmit={async (event) => {
          event.preventDefault();
          const trimmedName = name.trim();
          if (!trimmedName) return setError("请填写音色名称。");
          if (!sample) return setError("请上传或录制一段 10–90 秒的音频。");
          if (!consent) return setError("请先确认声音授权。");
          setIsSubmitting(true);
          setError(null);
          try {
            await onCreate({
              name: trimmedName,
              description: description.trim(),
              consentConfirmed: true,
              sample: sample.blob,
            });
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "音色克隆创建失败。");
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">创建音色克隆</h2>
            <p className="mt-1 text-sm leading-6 text-white/42">
              使用 10–90 秒清晰、单人、无背景音乐的语音效果最佳。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭音色克隆创建"
            disabled={isSubmitting}
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-xs font-medium text-white/62">
            名称
            <input
              value={name}
              maxLength={80}
              disabled={isSubmitting}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：我的旁白音色"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/25"
            />
          </label>
          <label className="block text-xs font-medium text-white/62">
            描述
            <textarea
              value={description}
              maxLength={500}
              rows={3}
              disabled={isSubmitting}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选，记录音色特点或用途"
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-white/25"
            />
          </label>

          <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-sm text-white/65 transition hover:bg-white/[0.05]">
                {isProcessingFile ? <SpinnerGap size={17} className="animate-spin" /> : <UploadSimple size={17} />}
                {isProcessingFile ? "处理中…" : "上传音频"}
                <input
                  type="file"
                  className="sr-only"
                  accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/opus,.mp3,.wav,.m4a,.opus"
                  disabled={isSubmitting || isProcessingFile}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void handleFile(input.files?.[0]).finally(() => (input.value = ""));
                  }}
                />
              </label>
              <button
                type="button"
                disabled={isSubmitting || isProcessingFile || pushToTalk.phase === "encoding"}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  void pushToTalk.beginHold(event.clientY);
                }}
                onPointerMove={(event) => pushToTalk.moveHold(event.clientY)}
                onPointerUp={() => pushToTalk.endHold()}
                onPointerCancel={() => pushToTalk.cancel()}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm transition ${pushToTalk.phase === "recording" ? "border-red-300/30 bg-red-400/10 text-red-100" : "border-white/10 text-white/65 hover:bg-white/[0.05]"}`}
              >
                <Microphone size={17} />
                {pushToTalk.phase === "requesting"
                  ? "等待授权…"
                  : pushToTalk.phase === "encoding"
                    ? "处理中…"
                    : pushToTalk.isCancelArmed
                      ? "松开取消"
                      : pushToTalk.phase === "recording"
                        ? `松开完成 ${pushToTalk.durationSeconds.toFixed(1)}s`
                        : "按住录音"}
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-white/38">
              支持 WAV、MP3、M4A、Opus；上传后会在本地转换为单声道 MP3。
            </p>
            {sample ? (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-300/[0.07] px-3 py-2 text-xs text-emerald-100/70">
                <span>样本已就绪</span>
                <span className="tabular-nums">{sample.durationSeconds.toFixed(1)} 秒</span>
              </div>
            ) : null}
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-white/8 p-4 text-xs leading-5 text-white/55">
            <input
              type="checkbox"
              checked={consent}
              disabled={isSubmitting}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-white"
            />
            <span>这是我的声音，或我已获得声音所有者对克隆和生成语音的明确授权。</span>
          </label>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-300/15 bg-red-400/[0.06] px-4 py-3 text-sm text-red-100/80">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting || isProcessingFile || !sample || !consent || !name.trim()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          {isSubmitting ? <SpinnerGap size={16} className="animate-spin" /> : null}
          {isSubmitting ? "正在创建音色克隆……" : "创建音色克隆"}
        </button>
      </form>
    </div>
  );
}

function formatVoiceCloneState(state: VoiceClone["state"]) {
  if (state === "trained") return "可使用";
  if (state === "failed") return "训练失败";
  if (state === "training") return "训练中";
  return "已创建";
}

function getAgentFallbackDescription(agent: Agent) {
  return agent.type === "slice-figure" ? agent.detail.persona : "";
}
