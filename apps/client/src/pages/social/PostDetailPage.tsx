import { ArrowLeft, Heart, NotePencil, Trash } from "@phosphor-icons/react";
import type { SocialPostSummary } from "@echoo/shared";
import { useEffect, useState } from "react";
import type { SocialService } from "../../services/SocialService";
import { MediaAsset } from "../../features/media/MediaAsset";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { PostComposer } from "./PostComposer";
import { SocialComments } from "./SocialComments";
import { formatDate } from "./PostCard";

export function PostDetailPage({
  postId,
  service,
  isAuthenticated,
  onRequireAuth,
  onBack,
  onOpenUser,
  onDeleted,
}: {
  postId: string;
  service: SocialService;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onBack: () => void;
  onOpenUser: (userId: string) => void;
  onDeleted: () => void;
}) {
  const [post, setPost] = useState<SocialPostSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void service
      .getPost(postId)
      .then((value) => {
        if (!cancelled) setPost(value);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "动态加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [postId, service]);

  if (!post)
    return (
      <div className="py-20 text-center text-sm text-white/40">
        {error ?? "正在加载动态……"}
      </div>
    );

  return (
    <section className="mx-auto max-w-3xl pb-24">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm text-white/48 hover:text-white"
      >
        <ArrowLeft size={17} />
        返回
      </button>
      {editing ? (
        <PostComposer
          service={service}
          initialPost={post}
          onCancel={() => setEditing(false)}
          onSaved={(value) => {
            setPost(value);
            setEditing(false);
          }}
        />
      ) : (
        <article className="overflow-hidden rounded-2xl border border-white/8 bg-[#111114]">
          <div className="p-6 md:p-8">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onOpenUser(post.author.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <IdentityAvatar
                  mediaUrl={post.author.avatarUrl}
                  alt=""
                  className="h-11 w-11"
                />
                <span>
                  <span className="block text-sm font-medium text-white">
                    {post.author.displayName}
                  </span>
                  <span className="text-[11px] text-white/30">
                    {formatDate(post.createdAt)}
                  </span>
                </span>
              </button>
              {post.canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="grid h-9 w-9 place-items-center rounded-full text-white/40 hover:bg-white/5 hover:text-white"
                >
                  <NotePencil size={17} />
                </button>
              ) : null}
              {post.canDelete ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("确定删除这条动态吗？")) return;
                    try {
                      await service.deletePost(post.id);
                      onDeleted();
                    } catch (reason) {
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "动态删除失败。",
                      );
                    }
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full text-white/40 hover:bg-red-400/10 hover:text-red-200"
                >
                  <Trash size={17} />
                </button>
              ) : null}
            </div>
            {post.body ? (
              <p className="mt-6 whitespace-pre-wrap text-[15px] leading-8 text-white/72">
                {post.body}
              </p>
            ) : null}
          </div>
          {post.images.length ? (
            <div
              className={`grid gap-px bg-white/5 ${post.images.length === 1 ? "grid-cols-1" : post.images.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
            >
              {post.images.map((image) => (
                <MediaAsset
                  key={image.resourceId}
                  mediaUrl={image.resourcePath}
                  variant="display"
                  alt="动态图片"
                  containerClassName="aspect-square bg-black/20"
                  className="h-full w-full object-cover"
                />
              ))}
            </div>
          ) : null}
          <div className="p-6 md:p-8">
            {error ? (
              <p className="mb-4 text-xs text-red-200/80">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                if (!isAuthenticated) return onRequireAuth();
                const liked = !post.viewerHasLiked;
                setPost({
                  ...post,
                  viewerHasLiked: liked,
                  likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
                });
                try {
                  const result = await service.setLiked(post.id, liked);
                  setPost((current) =>
                    current ? { ...current, ...result } : current,
                  );
                } catch {
                  setPost(post);
                }
              }}
              className={`mb-6 flex items-center gap-2 text-sm ${post.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/45"}`}
            >
              <Heart
                size={19}
                weight={post.viewerHasLiked ? "fill" : "regular"}
              />
              {post.likeCount} 人喜欢
            </button>
            <SocialComments
              objectId={post.id}
              service={service}
              isAuthenticated={isAuthenticated}
              onRequireAuth={onRequireAuth}
              onCountChange={(delta) =>
                setPost((current) =>
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
        </article>
      )}
    </section>
  );
}
