import {
  ArrowClockwise,
  ChatCircleDots,
  DownloadSimple,
  Heart,
  MagnifyingGlass,
  PaperPlaneTilt,
  SealCheck,
} from "@phosphor-icons/react";
import type {
  Agent,
  CharacterAssetSummary,
  SocialComment,
} from "@echoo/shared";
import { useEffect, useMemo, useState } from "react";
import { MediaAsset } from "../../features/media/MediaAsset";
import type { CharacterAssetService } from "../../services/CharacterAssetService";

export function CharacterCatalog({
  service,
  isAuthenticated,
  onAgentInstalled,
  onRequireAuth,
}: {
  service: CharacterAssetService;
  isAuthenticated: boolean;
  onAgentInstalled: (agent: Agent) => void;
  onRequireAuth: () => void;
}) {
  const [assets, setAssets] = useState<CharacterAssetSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeComments, setActiveComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, SocialComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<SocialComment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();

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
          setError(
            reason instanceof Error ? reason.message : "加载角色资产失败。",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, service]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) => {
      const snapshot = asset.snapshot;
      return [
        snapshot.name,
        snapshot.introduction,
        asset.author.displayName,
        ...snapshot.tags,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [assets, query]);

  const toggleLike = async (asset: CharacterAssetSummary) => {
    if (!isAuthenticated) return onRequireAuth();
    const nextLiked = !asset.viewerHasLiked;
    setAssets((current) =>
      current.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              viewerHasLiked: nextLiked,
              likeCount: Math.max(0, item.likeCount + (nextLiked ? 1 : -1)),
            }
          : item,
      ),
    );
    try {
      const result = await service.setLiked(asset.id, nextLiked);
      setAssets((current) =>
        current.map((item) =>
          item.id === asset.id
            ? {
                ...item,
                viewerHasLiked: result.viewerHasLiked,
                likeCount: result.likeCount,
              }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "点赞失败。");
      setAssets((current) =>
        current.map((item) => (item.id === asset.id ? asset : item)),
      );
    }
  };

  const toggleComments = async (assetId: string) => {
    if (activeComments === assetId) {
      setActiveComments(null);
      return;
    }
    setActiveComments(assetId);
    if (comments[assetId]) return;
    try {
      const page = await service.listComments(assetId);
      setComments((current) => ({ ...current, [assetId]: page.items }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载评论失败。");
    }
  };

  const submitComment = async (assetId: string) => {
    if (!isAuthenticated) return onRequireAuth();
    const body = commentDraft.trim();
    if (!body) return;
    setBusyId(assetId);
    try {
      const created = await service.createComment(
        assetId,
        body,
        replyingTo?.id,
      );
      setComments((current) => ({
        ...current,
        [assetId]: [created, ...(current[assetId] ?? [])],
      }));
      setAssets((current) =>
        current.map((asset) =>
          asset.id === assetId
            ? { ...asset, commentCount: asset.commentCount + 1 }
            : asset,
        ),
      );
      setCommentDraft("");
      setReplyingTo(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发表评论失败。");
    } finally {
      setBusyId(null);
    }
  };

  const saveCommentEdit = async (assetId: string, commentId: string) => {
    const body = editingDraft.trim();
    if (!body) return;
    setBusyId(commentId);
    try {
      const updated = await service.updateComment(commentId, body);
      setComments((current) => ({
        ...current,
        [assetId]: (current[assetId] ?? []).map((comment) =>
          comment.id === commentId ? updated : comment,
        ),
      }));
      setEditingCommentId(null);
      setEditingDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "编辑评论失败。");
    } finally {
      setBusyId(null);
    }
  };

  const removeComment = async (
    assetId: string,
    commentId: string,
    hide: boolean,
  ) => {
    setBusyId(commentId);
    try {
      if (hide) await service.hideComment(commentId);
      else await service.deleteComment(commentId);
      setComments((current) => ({
        ...current,
        [assetId]: (current[assetId] ?? []).map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                body: "",
                status: hide ? "hidden" : "deleted",
                canEdit: false,
                canDelete: false,
                canHide: false,
              }
            : comment,
        ),
      }));
      setAssets((current) =>
        current.map((asset) =>
          asset.id === assetId
            ? { ...asset, commentCount: Math.max(0, asset.commentCount - 1) }
            : asset,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "处理评论失败。");
    } finally {
      setBusyId(null);
    }
  };

  const installOrUpdate = async (asset: CharacterAssetSummary) => {
    if (!isAuthenticated) return onRequireAuth();
    setBusyId(asset.id);
    try {
      const result = asset.installedVersionId
        ? await service.updateInstallation(
            asset.id,
            asset.hasRecommendedRuntimeConfig &&
              window.confirm(
                "新版本附带了作者更新的推荐运行配置。是否同时应用？这会覆盖当前会话配置。",
              ),
          )
        : await service.install(
            asset.id,
            asset.hasRecommendedRuntimeConfig &&
              window.confirm(
                "作者附带了一份推荐运行配置。是否应用到这个角色的会话？",
              ),
          );
      onAgentInstalled(result.agent);
      setAssets((current) =>
        current.map((item) =>
          item.id === asset.id
            ? {
                ...item,
                installedVersionId: result.installedVersionId,
                installedVersionNumber: item.latestVersionNumber,
                updateAvailable: false,
              }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加角色失败。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-8">
      <header className="grid gap-7 border-b border-white/8 pb-8 lg:grid-cols-[1fr_360px] lg:items-end">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#aaa0c7]">
            角色公共档案馆
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
            找到一个值得长期相处的角色
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/48">
            每份角色资产都有独立版本。添加后，你的对话、记忆与日程只属于你的会话。
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 focus-within:border-[#aaa0c7]/60">
          <MagnifyingGlass size={18} className="text-white/40" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色、作者或标签"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
          />
        </label>
      </header>

      {loading ? (
        <EmptyState text="正在整理公共角色档案……" />
      ) : error && !assets.length ? (
        <EmptyState text={error} />
      ) : filtered.length ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {filtered.map((asset) => {
            const snapshot = asset.snapshot;
            const commentItems = comments[asset.id] ?? [];
            return (
              <article
                key={asset.id}
                className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#111114]"
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-[#8f82b4]" />
                <div className="relative h-64 overflow-hidden bg-gradient-to-br from-[#2a2633] via-[#17161d] to-[#0c0c0f]">
                  {snapshot.coverResourcePath ? (
                    <MediaAsset
                      className="absolute inset-0 h-full w-full object-cover opacity-55"
                      mediaUrl={snapshot.coverResourcePath}
                      variant="display"
                      alt=""
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
                  <div className="absolute left-7 top-6 flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-white/65 backdrop-blur-xl">
                    <SealCheck size={14} className="text-[#b9add8]" />v
                    {asset.latestVersionNumber} · {formatType(snapshot.type)}
                  </div>
                  <div className="absolute bottom-6 left-7 right-7 flex items-end gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/20 bg-white/[0.06] shadow-2xl">
                      {snapshot.avatarResourcePath ? (
                        <MediaAsset
                          className="h-full w-full object-cover"
                          mediaUrl={snapshot.avatarResourcePath}
                          variant="thumb"
                          alt={snapshot.name}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-3xl font-semibold tracking-[-0.03em] text-white">
                        {snapshot.name}
                      </h2>
                      <p className="mt-1 text-xs text-white/45">
                        由 {asset.author.displayName} 发布
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-7">
                  <p className="min-h-12 text-sm leading-6 text-white/56">
                    {snapshot.introduction || snapshot.detail.persona}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {asset.hasRecommendedRuntimeConfig ? (
                      <span className="rounded-full border border-[#a99bcf]/20 bg-[#a99bcf]/10 px-2.5 py-1 text-[11px] text-[#c7b9ed]">
                        含推荐运行配置
                      </span>
                    ) : null}
                    {snapshot.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/8 px-2.5 py-1 text-[11px] text-white/42"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-7 flex items-center gap-5 border-t border-white/8 pt-5 text-sm">
                    <button
                      type="button"
                      onClick={() => void toggleLike(asset)}
                      className={`flex items-center gap-2 transition ${asset.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/45 hover:text-white"}`}
                    >
                      <Heart
                        size={18}
                        weight={asset.viewerHasLiked ? "fill" : "regular"}
                      />
                      {asset.likeCount}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleComments(asset.id)}
                      className="flex items-center gap-2 text-white/45 transition hover:text-white"
                    >
                      <ChatCircleDots size={18} />
                      {asset.commentCount}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busyId === asset.id ||
                        Boolean(
                          asset.installedVersionId && !asset.updateAvailable,
                        )
                      }
                      onClick={() => void installOrUpdate(asset)}
                      className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-[#0a0a0c] transition active:scale-95 disabled:cursor-default disabled:bg-white/10 disabled:text-white/38"
                    >
                      {asset.updateAvailable ? (
                        <ArrowClockwise size={16} />
                      ) : (
                        <DownloadSimple size={16} />
                      )}
                      {asset.updateAvailable
                        ? "更新到最新版"
                        : asset.installedVersionId
                          ? "已添加"
                          : "添加角色"}
                    </button>
                  </div>

                  {activeComments === asset.id ? (
                    <div className="mt-6 border-t border-white/8 pt-5">
                      {replyingTo ? (
                        <div className="mb-2 flex items-center justify-between rounded-lg bg-[#aaa0c7]/8 px-3 py-2 text-xs text-[#c7b9ed]">
                          <span>回复 {replyingTo.author.displayName}</span>
                          <button
                            type="button"
                            onClick={() => setReplyingTo(null)}
                            className="text-white/40 hover:text-white"
                          >
                            取消
                          </button>
                        </div>
                      ) : null}
                      <div className="flex gap-3">
                        <input
                          value={commentDraft}
                          onChange={(event) =>
                            setCommentDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter")
                              void submitComment(asset.id);
                          }}
                          placeholder="写下具体、有帮助的评论"
                          className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-[#aaa0c7]/50"
                        />
                        <button
                          type="button"
                          aria-label="发表评论"
                          disabled={!commentDraft.trim() || busyId === asset.id}
                          onClick={() => void submitComment(asset.id)}
                          className="grid h-11 w-11 place-items-center rounded-xl bg-[#aaa0c7] text-[#111014] disabled:opacity-30"
                        >
                          <PaperPlaneTilt size={17} weight="fill" />
                        </button>
                      </div>
                      <div className="mt-4 space-y-3">
                        {commentItems.length ? (
                          commentItems.map((comment) => (
                            <div
                              key={comment.id}
                              className={`rounded-xl bg-white/[0.025] px-4 py-3 ${comment.parentCommentId ? "ml-6 border-l border-[#aaa0c7]/25" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <span className="font-medium text-white/70">
                                  {comment.author.displayName}
                                </span>
                                <span className="text-white/25">
                                  {formatDate(comment.createdAt)}
                                </span>
                              </div>
                              {editingCommentId === comment.id ? (
                                <div className="mt-3 flex gap-2">
                                  <input
                                    value={editingDraft}
                                    onChange={(event) =>
                                      setEditingDraft(event.target.value)
                                    }
                                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[#aaa0c7]/50"
                                  />
                                  <button
                                    type="button"
                                    disabled={busyId === comment.id}
                                    onClick={() =>
                                      void saveCommentEdit(asset.id, comment.id)
                                    }
                                    className="rounded-lg bg-white px-3 text-xs text-black disabled:opacity-40"
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingCommentId(null)}
                                    className="px-2 text-xs text-white/40"
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <p className="mt-2 text-sm leading-6 text-white/52">
                                  {comment.status === "visible"
                                    ? comment.body
                                    : "这条评论已不可见。"}
                                </p>
                              )}
                              {comment.status === "visible" ? (
                                <div className="mt-3 flex gap-3 text-[11px] text-white/32">
                                  {!comment.parentCommentId ? (
                                    <button
                                      type="button"
                                      onClick={() => setReplyingTo(comment)}
                                      className="hover:text-white/70"
                                    >
                                      回复
                                    </button>
                                  ) : null}
                                  {comment.canEdit ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCommentId(comment.id);
                                        setEditingDraft(comment.body);
                                      }}
                                      className="hover:text-white/70"
                                    >
                                      编辑
                                    </button>
                                  ) : null}
                                  {comment.canDelete ? (
                                    <button
                                      type="button"
                                      disabled={busyId === comment.id}
                                      onClick={() =>
                                        void removeComment(
                                          asset.id,
                                          comment.id,
                                          false,
                                        )
                                      }
                                      className="hover:text-red-200 disabled:opacity-30"
                                    >
                                      删除
                                    </button>
                                  ) : null}
                                  {comment.canHide ? (
                                    <button
                                      type="button"
                                      disabled={busyId === comment.id}
                                      onClick={() =>
                                        void removeComment(
                                          asset.id,
                                          comment.id,
                                          true,
                                        )
                                      }
                                      className="hover:text-red-200 disabled:opacity-30"
                                    >
                                      隐藏
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="py-4 text-center text-xs text-white/32">
                            还没有评论。说说这个角色最吸引你的地方。
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState text="没有找到匹配的角色资产。" />
      )}
      {error && assets.length ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-red-300/15 bg-[#211519]/90 px-4 py-2 text-xs text-red-100 backdrop-blur-xl">
          {error}
        </div>
      ) : null}
      {nextCursor ? (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={async () => {
              setBusyId("catalog-more");
              try {
                const page = await service.list({
                  sort: "latest",
                  limit: 24,
                  cursor: nextCursor,
                  q: query.trim() || undefined,
                });
                setAssets((current) => [
                  ...current,
                  ...page.items.filter(
                    (item) =>
                      !current.some((existing) => existing.id === item.id),
                  ),
                ]);
                setNextCursor(page.nextCursor);
              } finally {
                setBusyId(null);
              }
            }}
            className="rounded-full border border-white/10 px-6 py-3 text-xs text-white/55 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-30"
          >
            加载更多角色
          </button>
        </div>
      ) : null}
    </section>
  );
}

const placeholderPosts = [
  {
    author: "Lumen",
    time: "刚刚",
    body: "给角色写日程时，我开始把‘空白’也当成一种行动。不是每个时刻都需要回复。",
    topic: "创作札记",
  },
  {
    author: "纸月档案室",
    time: "18 分钟前",
    body: "今天完成了一组冬夜车站的参考图。下一步会让角色对同一地点形成不同时间层的记忆。",
    topic: "世界与图像",
  },
  {
    author: "Mori",
    time: "1 小时前",
    body: "切片角色不一定短暂。它更像把关系切到一个准确的横截面，然后允许人反复回到那里。",
    topic: "角色讨论",
  },
];

export function ExplorePage() {
  return (
    <section className="mx-auto max-w-4xl pb-20">
      <header className="border-b border-white/10 pb-8">
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#aaa0c7]">
          FIELD NOTES
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-white md:text-6xl">
          人们正在留下什么
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-white/48">
          这里会成为创作者与使用者的动态流。当前先展示内容形态，发布与互动稍后开放。
        </p>
      </header>

      <div className="mt-7 rounded-2xl border border-dashed border-[#aaa0c7]/25 bg-[#aaa0c7]/[0.045] p-5">
        <textarea
          disabled
          placeholder="分享一次角色变化、一段创作笔记或一张世界切片……"
          className="h-24 w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/28 disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between border-t border-white/8 pt-4">
          <span className="text-xs text-white/30">动态发布正在准备中</span>
          <button
            disabled
            className="rounded-full bg-white/10 px-5 py-2 text-xs text-white/35"
          >
            发布
          </button>
        </div>
      </div>

      <div className="mt-10 space-y-0 border-t border-white/10">
        {placeholderPosts.map((post) => (
          <article
            key={`${post.author}-${post.time}`}
            className="grid gap-4 border-b border-white/10 py-8 md:grid-cols-[150px_1fr]"
          >
            <div>
              <p className="text-sm font-medium text-white/78">{post.author}</p>
              <p className="mt-1 text-xs text-white/28">{post.time}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#aaa0c7]">
                {post.topic}
              </span>
              <p className="mt-3 text-lg leading-8 text-white/72">
                {post.body}
              </p>
              <div className="mt-5 flex gap-5 text-xs text-white/25">
                <span>喜欢 · —</span>
                <span>回应 · —</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-6 py-20 text-center text-sm text-white/40">
      {text}
    </div>
  );
}

function formatType(type: CharacterAssetSummary["snapshot"]["type"]) {
  return type === "prime-figure" ? "本初角色" : "切片角色";
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
