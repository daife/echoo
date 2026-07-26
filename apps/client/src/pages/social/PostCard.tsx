import { ChatCircleDots, Heart } from "@phosphor-icons/react";
import type { SocialPostSummary } from "@echoo/shared";
import { ExpandableMedia } from "../../features/media/ExpandableMedia";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { LinkedText } from "../../shared/components/LinkedText";

export function PostCard({
  post,
  onOpen,
  onOpenUser,
  onOpenPost,
  onOpenAsset,
  onToggleLike,
}: {
  post: SocialPostSummary;
  onOpen: () => void;
  onOpenUser?: (userId: string) => void;
  onOpenPost?: (postId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  onToggleLike?: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/8 bg-[#111114]">
      <div className="p-5 md:p-6">
        <button
          type="button"
          onClick={() => onOpenUser?.(post.author.id)}
          className="flex items-center gap-3 text-left"
        >
          <IdentityAvatar
            mediaUrl={post.author.avatarUrl}
            alt=""
            className="h-10 w-10"
            isAdmin={post.author.isAdmin}
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-medium text-white/82">
              <span>{post.author.displayName}</span>
              {post.author.isAdmin ? (
                <span className="rounded-full bg-[#d8c7ff]/12 px-2 py-0.5 text-[10px] font-semibold text-[#d8c7ff]">
                  管理员
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[11px] text-white/30">
              {formatDate(post.createdAt)}
            </span>
          </span>
        </button>
        {post.body ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).closest?.("a")) return;
              if (event.key === "Enter" || event.key === " ") onOpen();
            }}
            className="mt-4 block w-full cursor-pointer whitespace-pre-wrap text-left text-sm leading-7 text-white/67 line-clamp-6"
          >
            <LinkedText
              text={post.body}
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
            />
          </div>
        ) : null}
      </div>
      {post.images.length ? (
        <div
          className={`grid w-full gap-px bg-white/5 ${post.images.length === 1 ? "grid-cols-1" : post.images.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
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
      <div className="flex items-center gap-6 border-t border-white/8 px-5 py-4 text-sm text-white/42">
        <button
          type="button"
          onClick={onToggleLike}
          className={`flex items-center gap-2 transition hover:text-white ${post.viewerHasLiked ? "text-[#c7b9ed]" : ""}`}
        >
          <Heart size={18} weight={post.viewerHasLiked ? "fill" : "regular"} />{" "}
          {post.likeCount}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-2 transition hover:text-white"
        >
          <ChatCircleDots size={18} /> {post.commentCount}
        </button>
        <span className="ml-auto text-[11px] text-white/24">
          进入动态查看评论
        </span>
      </div>
    </article>
  );
}

export function formatDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
