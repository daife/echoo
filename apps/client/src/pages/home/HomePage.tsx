import { ArrowRight, ChatCircleDots, MagnifyingGlass, Plus, Sparkle, Waveform } from "@phosphor-icons/react";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";

const agents = [
  {
    name: "Aster",
    kind: "Core",
    description: "长期记忆型智能体，擅长陪你梳理项目、情绪和日常决策。",
    gradient: "from-white/24 via-white/8 to-transparent"
  },
  {
    name: "Mira",
    kind: "Slice",
    description: "轻量陪伴人格，适合短对话、灵感速记和睡前复盘。",
    gradient: "from-white/18 via-white/6 to-transparent"
  },
  {
    name: "Noir",
    kind: "Core",
    description: "冷静的结构化对话伙伴，适合处理复杂信息、复盘问题和保持上下文连续。",
    gradient: "from-white/20 via-white/5 to-transparent"
  }
];

export function HomePage({ onCreateAgent, onOpenChat }: { onCreateAgent: () => void; onOpenChat: () => void }) {
  return (
    <section className="relative space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-panel overflow-hidden rounded-2xl p-7 md:p-10">
          <div className="mb-8 flex items-center gap-3 text-sm text-white/50">
            <Sparkle size={18} />
            Agent chat across every surface
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-7xl">
            One quiet place for every intelligent conversation.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/58 md:text-lg">
            Echoo keeps each agent conversation consistent across client devices and any bound external interface under one account.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] shadow-[0_0_28px_rgba(255,255,255,0.22)] transition hover:shadow-[0_0_40px_rgba(255,255,255,0.30)] active:scale-95"
              onClick={onOpenChat}
            >
              Open chat
              <ArrowRight size={17} />
            </button>
            <button className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/75 transition hover:border-white/25 hover:text-white active:scale-95">
              Bind interface
            </button>
          </div>
        </div>

        <div className="glass-panel flex min-h-[420px] flex-col justify-between overflow-hidden rounded-2xl p-7">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/45">Realtime status</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">running</span>
          </div>
          <div className="grid place-items-center py-10">
            <div className="relative grid h-52 w-52 place-items-center rounded-full border border-white/10 bg-white/[0.025]">
              <div className="absolute inset-8 rounded-full border border-white/10" />
              <div className="absolute inset-16 rounded-full border border-white/10" />
              <Waveform className="text-white" size={70} weight="thin" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["12", "unread"],
              ["4", "bindings"],
              ["99%", "synced"]
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-white/8 bg-white/[0.025] p-4 text-center">
                <div className="text-2xl font-semibold text-white">{value}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/38">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/38">Companions</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Co-created agents</h2>
          </div>
          <button className="hidden items-center gap-2 text-sm text-white/55 transition hover:text-white md:flex">
            View all
            <ChatCircleDots size={18} />
          </button>
        </div>
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-3 text-white/42">
            <MagnifyingGlass size={17} />
            <span className="truncate text-sm">Search agents, memories, styles</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {["Trending", "Core", "Slice", "Following"].map((item, index) => (
              <button
                key={item}
                className={`rounded-full px-5 py-2 text-sm transition active:scale-95 ${
                  index === 0
                    ? "bg-white text-[#09090b]"
                    : "border border-white/10 text-white/60 hover:border-white/20 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {agents.map((agent) => (
            <CharacterCard key={agent.name} agent={agent} onOpenChat={onOpenChat} />
          ))}
        </div>
      </div>
      <button
        aria-label="Create agent"
        className="fixed bottom-28 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#09090b] shadow-[0_0_28px_rgba(255,255,255,0.28)] transition hover:scale-105 hover:shadow-[0_0_42px_rgba(255,255,255,0.36)] active:scale-95 md:bottom-10 md:right-16"
        onClick={onCreateAgent}
      >
        <Plus size={28} weight="bold" />
      </button>
    </section>
  );
}
