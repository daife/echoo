import { PaperPlaneTilt } from "@phosphor-icons/react";
import type { SocialComment } from "@echoo/shared";
import { useEffect, useMemo, useState } from "react";
import type { SocialService } from "../../services/SocialService";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { LinkedText } from "../../shared/components/LinkedText";
import { formatDate } from "./PostCard";

export function SocialComments({
  objectId,
  service,
  isAuthenticated,
  onRequireAuth,
  onCountChange,
  onOpenUser,
  onOpenPost,
  onOpenAsset,
}: {
  objectId: string;
  service: SocialService;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onCountChange?: (delta: number) => void;
  onOpenUser?: (userId: string) => void;
  onOpenPost?: (postId: string) => void;
  onOpenAsset?: (assetId: string) => void;
}) {
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<SocialComment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void service
      .listComments(objectId)
      .then((page) => {
        if (!cancelled) {
          setComments(page.items);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "评论加载失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, service]);

  const roots = useMemo(
    () => comments.filter((comment) => !comment.parentCommentId),
    [comments],
  );
  const replies = useMemo(() => {
    const result = new Map<string, SocialComment[]>();
    for (const comment of comments)
      if (comment.parentCommentId) {
        const list = result.get(comment.parentCommentId) ?? [];
        list.push(comment);
        result.set(comment.parentCommentId, list);
      }
    return result;
  }, [comments]);

  const submit = async () => {
    if (!isAuthenticated) return onRequireAuth();
    const body = draft.trim();
    if (!body) return;
    setBusy("new");
    try {
      const created = await service.createComment(
        objectId,
        body,
        replyingTo?.id,
      );
      setComments((current) => [created, ...current]);
      setDraft("");
      setReplyingTo(null);
      onCountChange?.(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评论发布失败。");
    } finally {
      setBusy(null);
    }
  };

  const renderComment = (comment: SocialComment, nested = false) => (
    <div
      key={comment.id}
      className={`rounded-xl border border-white/6 bg-white/[0.025] p-4 ${nested ? "ml-6 mt-2" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <button
          type="button"
          onClick={() => onOpenUser?.(comment.author.id)}
          className="flex items-center gap-2 font-medium text-white/72 hover:text-white"
        >
          <IdentityAvatar
            mediaUrl={comment.author.avatarUrl}
            alt=""
            className="h-7 w-7"
            isAdmin={comment.author.isAdmin}
          />
          <span>{comment.author.displayName}</span>
        </button>
        <span className="text-white/25">{formatDate(comment.createdAt)}</span>
      </div>
      {editingId === comment.id ? (
        <div className="mt-3 flex gap-2">
          <input
            value={editingDraft}
            onChange={(event) => setEditingDraft(event.target.value)}
            maxLength={4000}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
          />
          <button
            type="button"
            className="rounded-lg bg-white px-3 text-xs text-black"
            onClick={async () => {
              const body = editingDraft.trim();
              if (!body) return;
              setBusy(comment.id);
              try {
                const updated = await service.updateComment(comment.id, body);
                setComments((current) =>
                  current.map((item) =>
                    item.id === comment.id ? updated : item,
                  ),
                );
                setEditingId(null);
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : "评论编辑失败。",
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            保存
          </button>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/58">
          {comment.status === "visible" ? (
            <LinkedText
              text={comment.body}
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
            />
          ) : (
            "这条评论已不可见。"
          )}
        </p>
      )}
      {comment.status === "visible" ? (
        <div className="mt-3 flex gap-4 text-[11px] text-white/32">
          {!nested ? (
            <button
              type="button"
              onClick={() => {
                if (!isAuthenticated) onRequireAuth();
                else setReplyingTo(comment);
              }}
              className="hover:text-white"
            >
              回复
            </button>
          ) : null}
          {comment.canEdit ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(comment.id);
                setEditingDraft(comment.body);
              }}
              className="hover:text-white"
            >
              编辑
            </button>
          ) : null}
          {comment.canDelete || comment.canHide ? (
            <button
              type="button"
              disabled={busy === comment.id}
              className="hover:text-red-200 disabled:opacity-30"
              onClick={async () => {
                setBusy(comment.id);
                try {
                  if (comment.canDelete)
                    await service.deleteComment(comment.id);
                  else await service.hideComment(comment.id);
                  setComments((current) =>
                    current.map((item) =>
                      item.id === comment.id
                        ? {
                            ...item,
                            body: "",
                            status: comment.canDelete ? "deleted" : "hidden",
                            canEdit: false,
                            canDelete: false,
                            canHide: false,
                          }
                        : item,
                    ),
                  );
                  onCountChange?.(-1);
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "评论处理失败。",
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              {comment.canDelete ? "删除" : "隐藏"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="border-t border-white/8 pt-6">
      <h2 className="text-lg font-semibold text-white">评论</h2>
      {replyingTo ? (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-[#aaa0c7]/8 px-3 py-2 text-xs text-[#c7b9ed]">
          <span>回复 {replyingTo.author.displayName}</span>
          <button type="button" onClick={() => setReplyingTo(null)}>
            取消
          </button>
        </div>
      ) : null}
      <div className="mt-4 flex gap-3">
        <input
          value={draft}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder={
            isAuthenticated ? "写下具体、有帮助的评论" : "登录后参与评论"
          }
          className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-[#aaa0c7]/50"
        />
        <button
          type="button"
          aria-label="发表评论"
          disabled={!draft.trim() || busy === "new"}
          onClick={() => void submit()}
          className="grid h-11 w-11 place-items-center rounded-xl bg-[#aaa0c7] text-black disabled:opacity-30"
        >
          <PaperPlaneTilt size={17} weight="fill" />
        </button>
      </div>
      {error ? <p className="mt-3 text-xs text-red-200/80">{error}</p> : null}
      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="text-sm text-white/35">正在加载评论……</p>
        ) : roots.length ? (
          roots.map((root) => (
            <div key={root.id}>
              {renderComment(root)}
              {(replies.get(root.id) ?? []).map((reply) =>
                renderComment(reply, true),
              )}
            </div>
          ))
        ) : (
          <p className="py-5 text-sm text-white/32">
            还没有评论，成为第一个回复的人。
          </p>
        )}
      </div>
      {nextCursor ? (
        <button
          type="button"
          onClick={async () => {
            const page = await service.listComments(objectId, nextCursor);
            setComments((current) => {
              const known = new Set(current.map((comment) => comment.id));
              return [
                ...current,
                ...page.items.filter((comment) => !known.has(comment.id)),
              ];
            });
            setNextCursor(page.nextCursor);
          }}
          className="mt-4 w-full rounded-xl border border-white/8 py-3 text-xs text-white/42 hover:text-white"
        >
          加载更多评论
        </button>
      ) : null}
    </section>
  );
}
