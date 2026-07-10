import { ArrowRight, ChatCircleDots, MagnifyingGlass, Plus, Sparkle, Waveform } from "@phosphor-icons/react";
import { CharacterCard } from "../../features/conversations/components/CharacterCard";

const agents = [
  {
    name: "Aster",
    kind: "本初角色",
    description: "推进型角色，擅长长期关系、数值变化、行为和日程推进。",
    gradient: "from-white/24 via-white/8 to-transparent"
  },
  {
    name: "Mira",
    kind: "切片角色",
    description: "轻量角色，适合短对话、片段场景、灵感速记和睡前复盘。",
    gradient: "from-white/18 via-white/6 to-transparent"
  },
  {
    name: "Noir",
    kind: "本初角色",
    description: "冷静的推进型角色，适合处理复杂信息、复盘问题和保持长期状态连续。",
    gradient: "from-white/20 via-white/5 to-transparent"
  }
];

export function HomePage({
  onCreateAgent,
  onOpenChat
}: {
  onCreateAgent: () => void;
  onOpenChat: () => void;
}) {
  return (
    <section className="relative space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-panel overflow-hidden rounded-2xl p-7 md:p-10">
          <div className="mb-8 flex items-center gap-3 text-sm text-white/50">
            <Sparkle size={18} />
            跨越所有终端的角色会话
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-7xl">
            让每段鲜活的角色会话，都安静地归于一处。
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/58 md:text-lg">
            Echoo 让同一账户下的每段角色会话，在所有客户端设备和已绑定的外部界面中保持一致。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] shadow-[0_0_28px_rgba(255,255,255,0.22)] transition hover:shadow-[0_0_40px_rgba(255,255,255,0.30)] active:scale-95"
              onClick={onOpenChat}
            >
              打开聊天
              <ArrowRight size={17} />
            </button>
            <button className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/75 transition hover:border-white/25 hover:text-white active:scale-95">
              绑定界面
            </button>
          </div>
        </div>

        <div className="glass-panel flex min-h-[420px] flex-col justify-between overflow-hidden rounded-2xl p-7">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/45">实时状态</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">运行中</span>
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
              ["12", "未读"],
              ["4", "绑定"],
              ["99%", "已同步"]
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
            <p className="text-xs uppercase tracking-[0.22em] text-white/38">伙伴</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">共创角色</h2>
          </div>
          <button className="hidden items-center gap-2 text-sm text-white/55 transition hover:text-white md:flex">
            查看全部
            <ChatCircleDots size={18} />
          </button>
        </div>
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-3 text-white/42">
            <MagnifyingGlass size={17} />
            <span className="truncate text-sm">搜索角色、记忆与风格</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {["热门", "本初角色", "切片角色", "关注中"].map((item, index) => (
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
            <CharacterCard key={agent.name} agent={agent} onOpenChat={() => onOpenChat()} />
          ))}
        </div>
      </div>
      <button
        aria-label="创建角色"
        className="fixed bottom-28 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#09090b] shadow-[0_0_28px_rgba(255,255,255,0.28)] transition hover:scale-105 hover:shadow-[0_0_42px_rgba(255,255,255,0.36)] active:scale-95 md:bottom-10 md:right-16"
        onClick={onCreateAgent}
      >
        <Plus size={28} weight="bold" />
      </button>
    </section>
  );
}
