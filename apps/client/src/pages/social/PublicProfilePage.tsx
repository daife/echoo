import { ArrowLeft, UsersThree, X } from "@phosphor-icons/react";
import type {
  Agent,
  PublicUserProfile,
  SocialPostSummary,
} from "@echoo/shared";
import type { PublicAssetListItem } from "@echoo/shared/public-assets";
import { useEffect, useMemo, useState } from "react";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import { useAuth } from "../../app/providers/AuthProvider";
import { useServices } from "../../app/providers/ServicesProvider";
import { IdentityAvatar } from "../../shared/components/IdentityAvatar";
import { PostCard } from "./PostCard";
import { PostComposer } from "./PostComposer";

export function PublicProfilePage({
  userId,
  onBack,
  onOpenPost,
  onOpenAsset,
  onOpenUser,
  onRequireAuth,
}: {
  userId: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onOpenUser: (userId: string) => void;
  onRequireAuth: () => void;
}) {
  const auth = useAuth();
  const { socialService, publicAssetService } = useServices();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [tab, setTab] = useState<"creations" | "posts">("creations");
  const [posts, setPosts] = useState<SocialPostSummary[]>([]);
  const [assets, setAssets] = useState<PublicAssetListItem[]>([]);
  const [assetType, setAssetType] = useState<"all" | Agent["type"]>("all");
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(() => setList(null), {
    enabled: list !== null,
    priority: BACK_HANDLER_PRIORITY.dialog,
  });
  const filteredAssets = useMemo(
    () =>
      assetType === "all"
        ? assets
        : assets.filter((asset) => asset.snapshot.type === assetType),
    [assetType, assets],
  );

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError(null);
    void socialService
      .getUser(userId)
      .then((value) => {
        if (!cancelled) setProfile(value);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "用户加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [socialService, userId]);
  useEffect(() => {
    let cancelled = false;
    if (tab === "posts") setPosts([]);
    else setAssets([]);
    const request =
      tab === "posts"
        ? socialService.listUserPosts(userId)
        : publicAssetService.listByUser(userId, {
            type: assetType === "all" ? undefined : assetType,
          });
    void request.then((page) => {
      if (cancelled) return;
      if (tab === "posts")
        setPosts((page as { items: SocialPostSummary[] }).items);
      else setAssets((page as { items: PublicAssetListItem[] }).items);
    });
    return () => {
      cancelled = true;
    };
  }, [assetType, publicAssetService, socialService, tab, userId]);

  if (!profile)
    return (
      <div className="py-20 text-center text-sm text-white/40">
        {error ?? "正在加载用户主页……"}
      </div>
    );
  return (
    <section className="mx-auto max-w-5xl space-y-7 pb-24">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-white/48 hover:text-white"
      >
        <ArrowLeft size={17} />
        返回
      </button>
      <header className="rounded-2xl border border-white/8 bg-white/[0.025] p-7 text-center md:p-10">
        <IdentityAvatar
          mediaUrl={profile.avatarUrl}
          alt=""
          className="mx-auto h-28 w-28"
          variant="display"
          isAdmin={profile.isAdmin}
        />
        <h1 className="mt-5 text-4xl font-semibold text-white">
          {profile.displayName}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
          {profile.signature || "尚未填写个性签名"}
        </p>
        <div className="mt-6 flex justify-center gap-8 text-sm">
          <button type="button" onClick={() => setList("followers")}>
            <strong className="text-white">{profile.followerCount}</strong>
            <span className="ml-2 text-white/38">关注者</span>
          </button>
          <button type="button" onClick={() => setList("following")}>
            <strong className="text-white">{profile.followingCount}</strong>
            <span className="ml-2 text-white/38">正在关注</span>
          </button>
        </div>
        {!profile.isSelf ? (
          <button
            type="button"
            onClick={async () => {
              if (!auth.user) return onRequireAuth();
              const result = await socialService.setFollowing(
                profile.id,
                !profile.viewerIsFollowing,
              );
              setProfile({
                ...profile,
                viewerIsFollowing: result.following,
                followerCount: result.followerCount,
                isMutual: result.isMutual,
              });
            }}
            className={`mt-6 rounded-full px-6 py-2.5 text-sm font-medium ${profile.viewerIsFollowing ? "border border-white/12 text-white/65" : "bg-white text-black"}`}
          >
            {profile.viewerIsFollowing ? "已关注" : "关注"}
          </button>
        ) : null}
        {profile.isMutual ? (
          <p className="mt-3 text-xs text-[#c7b9ed]">互相关注</p>
        ) : profile.followsViewer ? (
          <p className="mt-3 text-xs text-white/35">对方关注了你</p>
        ) : null}
      </header>
      <div className="grid grid-cols-2 gap-2 rounded-full border border-white/8 bg-white/[0.025] p-1.5">
        <button
          type="button"
          onClick={() => setTab("creations")}
          className={`rounded-full py-3 text-sm ${tab === "creations" ? "bg-white text-black" : "text-white/50"}`}
        >
          创作
        </button>
        <button
          type="button"
          onClick={() => setTab("posts")}
          className={`rounded-full py-3 text-sm ${tab === "posts" ? "bg-white text-black" : "text-white/50"}`}
        >
          动态
        </button>
      </div>
      {tab === "creations" ? (
        <PublicProfileAssetFilters
          assetType={assetType}
          onChange={setAssetType}
        />
      ) : null}
      {tab === "posts" ? (
        <div className="mx-auto max-w-3xl space-y-5">
          {profile.isSelf ? (
            <PostComposer
              service={socialService}
              onSaved={(post) => setPosts((current) => [post, ...current])}
            />
          ) : null}
          {posts.length ? (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpen={() => onOpenPost(post.id)}
                onOpenUser={onOpenUser}
                onToggleLike={async () => {
                  if (!auth.user) return onRequireAuth();
                  const result = await socialService.setLiked(
                    post.id,
                    !post.viewerHasLiked,
                  );
                  setPosts((current) =>
                    current.map((item) =>
                      item.id === post.id ? { ...item, ...result } : item,
                    ),
                  );
                }}
              />
            ))
          ) : (
            <Empty text="还没有发布动态。" />
          )}
        </div>
      ) : filteredAssets.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onOpenAsset(asset.id)}
              className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.025] text-left"
            >
              <div className="p-5">
                <p className="text-xl font-semibold text-white">
                  {asset.snapshot.name}
                </p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/48">
                  {asset.snapshot.preview}
                </p>
                <p className="mt-4 text-xs text-white/28">
                  {asset.likeCount} 喜欢 · {asset.commentCount} 评论
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty text={assets.length ? "该类型还没有公开创作。" : "还没有公开创作。"} />
      )}
      {list ? (
        <FollowListDialog
          userId={profile.id}
          direction={list}
          onClose={() => setList(null)}
          onOpenUser={(id) => {
            setList(null);
            onOpenUser(id);
          }}
        />
      ) : null}
    </section>
  );
}

export function PublicProfileAssetFilters({
  assetType,
  onChange,
}: {
  assetType: "all" | Agent["type"];
  onChange: (assetType: "all" | Agent["type"]) => void;
}) {
  return (
    <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
      {([
        ["all", "全部"],
        ["slice-figure", "切片角色"],
        ["prime-figure", "本初角色"],
        ["prime-world", "本初世界"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`shrink-0 rounded-full border px-4 py-2 text-xs ${assetType === value ? "border-white bg-white text-black" : "border-white/10 text-white/50"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FollowListDialog({
  userId,
  direction,
  onClose,
  onOpenUser,
}: {
  userId: string;
  direction: "followers" | "following";
  onClose: () => void;
  onOpenUser: (userId: string) => void;
}) {
  const { socialService } = useServices();
  const [items, setItems] = useState<PublicUserProfile[]>([]);
  useEffect(() => {
    void (
      direction === "followers"
        ? socialService.listFollowers(userId)
        : socialService.listFollowingUsers(userId)
    ).then((page) => setItems(page.items));
  }, [direction, socialService, userId]);
  return (
    <div className="app-overlay fixed inset-0 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111114] p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <UsersThree size={20} />
            {direction === "followers" ? "关注者" : "正在关注"}
          </h2>
          <button type="button" onClick={onClose} className="text-white/45">
            <X size={20} />
          </button>
        </div>
        <div className="mt-5 max-h-[60vh] space-y-2 overflow-auto">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenUser(item.id)}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5"
            >
              <IdentityAvatar
                mediaUrl={item.avatarUrl}
                alt=""
                className="h-10 w-10"
                isAdmin={item.isAdmin}
              />
              <span>
                <span className="block text-sm text-white/80">
                  {item.displayName}
                </span>
                {item.isMutual ? (
                  <span className="text-[11px] text-[#c7b9ed]">互相关注</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/35">
      {text}
    </div>
  );
}
