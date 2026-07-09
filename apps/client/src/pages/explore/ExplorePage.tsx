import { BookmarkSimple, ChatCircleDots, DotsThree, Heart, MagnifyingGlass, PaperPlaneTilt } from "@phosphor-icons/react";

const posts = [
  {
    author: "quiet_lab",
    handle: "@quiet_lab",
    time: "12 min ago",
    title: "今天把 Aster 的长期记忆边界重新整理了一遍",
    body: "Prime Figure 不应该记住所有细节，而是记住那些会改变关系、偏好、数值和目标的东西。剩下的信息应该像雾一样散开。",
    stats: ["1.2k", "86"],
    visual: "aspect-[4/5]"
  },
  {
    author: "night_notes",
    handle: "@night_notes",
    time: "38 min ago",
    title: "Slice Figure 更像一次短暂的同频",
    body: "它不需要承诺长期推进，只需要在一个很小的场景里足够准确、足够轻。",
    stats: ["842", "41"],
    visual: "aspect-square"
  },
  {
    author: "system_poet",
    handle: "@system_poet",
    time: "2 hours ago",
    title: "如果一个 figure 太会讨好人，它就会失去轮廓",
    body: "我更喜欢它保留一点稳定的立场。不是反驳用户，而是有自己的节奏、判断和沉默。",
    stats: ["2.8k", "153"],
    visual: ""
  }
];

export function ExplorePage() {
  return (
    <section className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">Explore</p>
        <h1 className="mt-2 text-4xl font-semibold text-white md:text-5xl">Community posts</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-white/52">
          探索页用于查看用户围绕 figure 共创、记忆、人格设定和会话体验发布的内容。
        </p>
      </div>

      <div className="glass-panel flex items-center gap-3 rounded-full px-5 py-4 text-white/45">
        <MagnifyingGlass size={18} />
        <span className="truncate text-sm">Search posts, creators, creation notes</span>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {posts.map((post) => (
          <article key={post.title} className="glass-panel overflow-hidden rounded-2xl transition hover:border-white/18">
            <div className="flex items-center gap-4 p-6">
              <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white">
                {post.author.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-white">{post.handle}</h2>
                <p className="mt-1 text-xs text-white/38">{post.time}</p>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.05] hover:text-white">
                <DotsThree size={22} weight="bold" />
              </button>
            </div>

            {post.visual ? (
              <div className={`${post.visual} relative bg-gradient-to-br from-white/[0.16] via-white/[0.05] to-transparent`}>
                <div className="absolute inset-8 rounded-[2rem] border border-white/10 bg-black/20 backdrop-blur-xl" />
                <div className="absolute bottom-6 left-6 right-6 text-3xl font-semibold leading-tight text-white md:text-4xl">{post.title}</div>
              </div>
            ) : null}

            <div className="p-6">
              {!post.visual ? <h2 className="text-2xl font-semibold leading-tight text-white">{post.title}</h2> : null}
              <p className="mt-4 text-sm leading-6 text-white/58">{post.body}</p>
              <div className="mt-6 flex items-center gap-6 text-sm text-white/45">
                <button className="flex items-center gap-2 transition hover:text-white">
                  <Heart size={18} />
                  {post.stats[0]}
                </button>
                <button className="flex items-center gap-2 transition hover:text-white">
                  <ChatCircleDots size={18} />
                  {post.stats[1]}
                </button>
                <button className="ml-auto transition hover:text-white">
                  <PaperPlaneTilt size={18} />
                </button>
                <button className="transition hover:text-white">
                  <BookmarkSimple size={18} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
