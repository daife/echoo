import { ChatCircleDots, Heart } from "@phosphor-icons/react";
import type { SocialPostSummary } from "@echoo/shared";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { PostContent } from "./PostContent";

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
        {post.content.length ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
              if (
                (event.target as HTMLElement).closest?.(
                  "a,button,audio,input,textarea,select",
                )
              )
                return;
              if (event.key === "Enter" || event.key === " ") onOpen();
            }}
            className="mt-4 block w-full cursor-pointer text-left text-sm leading-7 text-white/67"
          >
            <PostContent
              content={post.content}
              authorName={post.author.displayName}
              onOpenPost={onOpenPost}
              onOpenAsset={onOpenAsset}
              variant="compact"
            />
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-6 border-t border-white/8 px-5 py-4 text-sm text-white/42">
        <button
          type="button"
          onClick={onToggleLike}
          aria-label={post.viewerHasLiked ? "取消点赞" : "点赞"}
          className={`flex min-h-9 items-center gap-2 rounded-lg px-2 -mx-2 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98] ${post.viewerHasLiked ? "text-[#c7b9ed]" : ""}`}
        >
          <Heart size={18} weight={post.viewerHasLiked ? "fill" : "regular"} />{" "}
          {post.likeCount}
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label="查看评论"
          className="flex min-h-9 items-center gap-2 rounded-lg px-2 -mx-2 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98]"
        >
          <ChatCircleDots size={18} /> {post.commentCount}
        </button>
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
