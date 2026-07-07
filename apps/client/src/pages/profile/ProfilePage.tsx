import { ChatCircleDots, GearSix, Heart, NotePencil, PencilSimple, Robot } from "@phosphor-icons/react";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";

const creations = [
  {
    name: "Aster",
    kind: "Core",
    description: "长期记忆型智能体，擅长陪你梳理项目、情绪和日常决策。",
    gradient: "from-white/22 via-white/7 to-transparent"
  },
  {
    name: "Mira",
    kind: "Slice",
    description: "轻量陪伴人格，适合短对话、灵感速记和睡前复盘。",
    gradient: "from-white/16 via-white/5 to-transparent"
  }
];

const posts = [
  {
    title: "关于 Core 记忆的三条边界",
    body: "长期记忆应该服务于关系，而不是复制聊天记录。",
    likes: "812",
    replies: "34"
  },
  {
    title: "我为什么喜欢 Slice",
    body: "它像一段短促但准确的共鸣，不需要承担完整人格。",
    likes: "509",
    replies: "21"
  }
];

export function ProfilePage({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-7 text-center md:p-10">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[110px]" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="grid h-36 w-36 place-items-center rounded-full border border-white/18 bg-white/[0.05] shadow-[0_0_48px_rgba(255,255,255,0.12)] md:h-40 md:w-40">
            <Robot size={72} weight="thin" className="text-white" />
          </div>
          <h1 className="mt-6 text-4xl font-semibold text-white md:text-5xl">Aether</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">
            一个正在共创智能体的人。偏好安静、连续、带长期记忆的对话体验。
          </p>
          <div className="mt-7 grid w-full max-w-2xl grid-cols-3 border-y border-white/10 py-5">
            {[
              ["12", "Agents"],
              ["8", "Core"],
              ["4", "Slice"]
            ].map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-semibold text-white">{value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/38">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] active:scale-95">
              <PencilSimple size={17} />
              Edit profile
            </button>
            <button className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm text-white/70 transition hover:border-white/25 hover:text-white active:scale-95">
              <GearSix size={17} />
              Preferences
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-full p-1.5">
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-full bg-white py-3 text-sm font-medium text-[#09090b]">Creations</button>
          <button className="rounded-full py-3 text-sm font-medium text-white/55 transition hover:text-white">Posts</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">My agents</h2>
            <span className="text-sm text-white/40">Core and Slice</span>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {creations.map((agent) => (
              <CharacterCard key={agent.name} agent={agent} onOpenChat={onOpenChat} />
            ))}
          </div>
        </div>
        <aside className="glass-panel h-fit rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
              <NotePencil size={21} weight="duotone" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Recent posts</h2>
              <p className="text-xs text-white/40">Creation notes and reflections</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {posts.map((post) => (
              <article key={post.title} className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
                <h3 className="text-sm font-medium leading-5 text-white">{post.title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/45">{post.body}</p>
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
    </section>
  );
}
