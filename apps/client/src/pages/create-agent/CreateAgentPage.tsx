import { ArrowRight, Brain, CirclesThreePlus, Sparkle } from "@phosphor-icons/react";

const typeCards = [
  {
    type: "Core",
    title: "Create a Core",
    description: "用于长期陪伴、稳定人格、持续记忆和深层关系。",
    icon: Brain
  },
  {
    type: "Slice",
    title: "Create a Slice",
    description: "用于短场景、轻量人格、快速试验和临时任务。",
    icon: CirclesThreePlus
  }
];

export function CreateAgentPage() {
  return (
    <section className="space-y-8">
      <div className="glass-panel overflow-hidden rounded-2xl p-7 md:p-10">
        <div className="mb-8 flex items-center gap-3 text-sm text-white/50">
          <Sparkle size={18} />
          Co-create an agent
        </div>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-6xl">
          Shape a companion from memory, tone, and purpose.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">
          先选择 Core 或 Slice。创建流程后续会连接账号、记忆、人格设定和外部接口绑定。
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {typeCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.type} className="group glass-panel rounded-2xl p-6 transition hover:border-white/18">
              <div className="flex items-start justify-between gap-6">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                  <Icon size={28} weight="duotone" />
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">{card.type}</span>
              </div>
              <h2 className="mt-8 text-3xl font-semibold text-white">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/52">{card.description}</p>
              <button className="mt-8 flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition active:scale-95">
                Start
                <ArrowRight size={17} />
              </button>
            </article>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-6">
        <h2 className="text-xl font-semibold text-white">Creation notes</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {["Define relationship", "Set memory rules", "Bind interface later"].map((item) => (
            <div key={item} className="rounded-xl border border-white/8 bg-black/20 p-4 text-sm text-white/55">
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
