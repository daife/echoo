import { Heart, NotePencil, Trash } from "@phosphor-icons/react";
import type { SocialPostSummary } from "@echoo/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { SocialService } from "../../services/SocialService";
import { ExpandableMedia } from "../../features/media/ExpandableMedia";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { BackButton } from "../../shared/components/BackButton";
import { LinkedText } from "../../shared/components/LinkedText";
import { ShareButton } from "../../shared/components/ShareButton";
import { PostComposer } from "./PostComposer";
import { SocialComments } from "./SocialComments";
import { formatDate } from "./PostCard";
import {
  patchPostInSocialCaches,
  removePostFromSocialCaches,
} from "./socialQueryCache";

export function PostDetailPage({
  postId,
  service,
  isAuthenticated,
  onRequireAuth,
  onBack,
  onOpenUser,
  onOpenPost,
  onOpenAsset,
  onDeleted,
  viewerId,
}: {
  postId: string;
  service: SocialService;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onBack: () => void;
  onOpenUser: (userId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onDeleted: () => void;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
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
      <BackButton className="mb-6" onClick={onBack} />
      {editing ? (
        <PostComposer
          service={service}
          initialPost={post}
          onCancel={() => setEditing(false)}
          onSaved={(value) => {
            setPost(value);
            patchPostInSocialCaches(queryClient, viewerId, value.id, value);
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
                  isAdmin={post.author.isAdmin}
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <span>{post.author.displayName}</span>
                    {post.author.isAdmin ? (
                      <span className="rounded-full bg-[#d8c7ff]/12 px-2 py-0.5 text-[10px] font-semibold text-[#d8c7ff]">
                        管理员
                      </span>
                    ) : null}
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
                      removePostFromSocialCaches(
                        queryClient,
                        viewerId,
                        post.id,
                      );
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
                <LinkedText
                  text={post.body}
                  onOpenPost={onOpenPost}
                  onOpenAsset={onOpenAsset}
                />
              </p>
            ) : null}
          </div>
          {post.images.length ? (
            <div
              className={`grid gap-px bg-white/5 ${post.images.length === 1 ? "grid-cols-1" : post.images.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
            >
              {post.images.map((image, index) => (
                <ExpandableMedia
                  key={image.resourceId}
                  mediaUrl={image.resourcePath}
                  kind="image"
                  previewVariant="display"
                  alt={`${post.author.displayName} 的动态图片 ${index + 1}`}
                  triggerClassName="group relative block aspect-square w-full overflow-hidden bg-black/20"
                  mediaClassName="h-full w-full object-cover"
                />
              ))}
            </div>
          ) : null}
          <div className="p-6 md:p-8">
            {error ? (
              <p className="mb-4 text-xs text-red-200/80">{error}</p>
            ) : null}
            <div className="mb-6 flex items-center gap-6">
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
                  patchPostInSocialCaches(queryClient, viewerId, post.id, {
                    viewerHasLiked: liked,
                    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
                  });
                  try {
                    const result = await service.setLiked(post.id, liked);
                    patchPostInSocialCaches(
                      queryClient,
                      viewerId,
                      post.id,
                      result,
                    );
                    setPost((current) =>
                      current ? { ...current, ...result } : current,
                    );
                  } catch {
                    setPost(post);
                    patchPostInSocialCaches(
                      queryClient,
                      viewerId,
                      post.id,
                      post,
                    );
                  }
                }}
                className={`flex items-center gap-2 text-sm ${post.viewerHasLiked ? "text-[#c7b9ed]" : "text-white/45"}`}
              >
                <Heart
                  size={19}
                  weight={post.viewerHasLiked ? "fill" : "regular"}
                />
                {post.likeCount} 人喜欢
              </button>
              <ShareButton
                target={{ type: "post", id: post.id }}
                title={`${post.author.displayName} 的动态`}
                text={post.body.slice(0, 120)}
              />
            </div>
            <SocialComments
              objectId={post.id}
              service={service}
              isAuthenticated={isAuthenticated}
              onRequireAuth={onRequireAuth}
              onCountChange={(delta) => {
                setPost((current) =>
                  current
                    ? {
                        ...current,
                        commentCount: Math.max(0, current.commentCount + delta),
                      }
                    : current,
                );
                patchPostInSocialCaches(
                  queryClient,
                  viewerId,
                  post.id,
                  (current) => ({
                    ...current,
                    commentCount: Math.max(0, current.commentCount + delta),
                  }),
                );
              }}
              onOpenUser={onOpenUser}
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
            />
          </div>
        </article>
      )}
    </section>
  );
}
