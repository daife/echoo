import {
  ChatCircleDots,
  GearSix,
  Heart,
  NotePencil,
  PencilSimple,
  SpinnerGap,
  Trash,
  UploadSimple,
  Archive,
  X,
} from "@phosphor-icons/react";
import type {
  Agent,
  AgentResourceUpload,
  CharacterAssetDraft,
  UpdateUserProfileRequest,
  UserProfile,
} from "@echoo/shared";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { imageFileToUpload } from "../../shared/utils/imageCompression";

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
  const auth = useAuth();
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
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
          <IdentityAvatar
            mediaUrl={auth.user?.avatarUrl}
            alt={auth.user ? `${auth.user.displayName}的头像` : "用户头像"}
            variant="display"
            className="h-36 w-36 border-white/18 shadow-[0_0_48px_rgba(255,255,255,0.12)] md:h-40 md:w-40"
          />
          <h1 className="mt-6 text-4xl font-semibold text-white md:text-5xl">
            {auth.user?.displayName ?? ""}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">
            {auth.user?.signature || "尚未填写个性签名"}
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
    </section>
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] md:p-7"
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
          />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <label className="cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-medium text-[#09090b] transition active:scale-95 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white">
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
                className="flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/58 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
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
            支持 JPEG、PNG、WebP、GIF，保存前会压缩至 5MB 内。
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
