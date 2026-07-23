import {
  GearSix,
  NotePencil,
  PencilSimple,
  Plus,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  Agent,
  AgentResourceUpload,
  UpdateUserProfileRequest,
  UserProfile,
  SocialPostSummary,
} from "@echoo/shared";
import type {
  CreatePublicAssetDraftRequest,
  PublicAssetDraft,
} from "@echoo/shared/public-assets";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";
import { useEffect, useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { imageFileToUpload } from "../../shared/utils/imageCompression";
import { useServices } from "../../app/providers/ServicesProvider";
import { PostComposer } from "../social/PostComposer";
import { PostCard } from "../social/PostCard";
import { createOptions } from "../create-agent/createAgentOptions";

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
  const { socialService } = useServices();
  const [activeTab, setActiveTab] = useState<"creations" | "posts">(
    "creations",
  );
  const [userPosts, setUserPosts] = useState<SocialPostSummary[]>([]);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [isPublicCreateOpen, setIsPublicCreateOpen] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
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

  useEffect(() => {
    if (!auth.user || activeTab !== "posts") return;
    let cancelled = false;
    void socialService.listUserPosts(auth.user.id).then((page) => {
      if (!cancelled) setUserPosts(page.items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, auth.user, socialService]);

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
                      由你直接创建，可以导入为新的公共资产草稿。
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
                      从公共资产添加的会话
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      保留原公共资产来源，可查看详情，但不能再次导入发布。
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
                      还没有从公共资产添加的会话。
                    </div>
                  )}
                </section>
              </div>
            )}

            <div className="mb-5 mt-12 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">
                  我的公共资产
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
                创建公共资产
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
                还没有公共资产。你可以从空白开始，也可以从原创会话导入初始设定。
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
              setUserPosts((current) => [
                post,
                ...current.filter((item) => item.id !== post.id),
              ])
            }
          />
          {userPosts.length ? (
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
                  setUserPosts((current) =>
                    current.map((item) =>
                      item.id === post.id ? { ...item, ...result } : item,
                    ),
                  );
                }}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
              还没有发布动态。
            </div>
          )}
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
                error instanceof Error ? error.message : "公共资产创建失败。",
              );
              throw error;
            }
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

  return (
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/65 px-4 backdrop-blur-sm md:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label="创建公共资产"
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
              reason instanceof Error ? reason.message : "公共资产创建失败。",
            );
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">创建公共资产</h2>
            <p className="mt-1 text-sm leading-6 text-white/42">
              公共资产独立于原创会话，支持角色与本初世界。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭公共资产创建"
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
              资产类型
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
                暂无可导入的原创会话。从公共资产添加的会话不能再次发布。
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-white/38">
              只导入资产定义与媒体素材；不会导入消息、运行进度、密钥或会话运行配置。
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

function getAgentFallbackDescription(agent: Agent) {
  return agent.type === "slice-figure" ? agent.detail.persona : "";
}
