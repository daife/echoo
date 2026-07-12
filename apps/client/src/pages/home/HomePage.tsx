import { ArrowRight, Brain, ChatCircleDots, Plus, Sparkle } from "@phosphor-icons/react";

export function HomePage({ onCreateAgent, onOpenChat }: {
  onCreateAgent: () => void; onOpenChat: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[1.25rem] bg-[#0d0d10]/92 px-7 pb-10 pt-8 md:px-12 md:pb-14 md:pt-12">
      <div className="absolute right-[-8rem] top-[-10rem] h-[28rem] w-[28rem] rounded-full border border-white/10" />
      <div className="absolute right-[-3rem] top-[-5rem] h-[18rem] w-[18rem] rounded-full border border-white/10" />

      <div className="relative max-w-4xl">
        <div className="flex items-center gap-2 text-xs tracking-[0.14em] text-white/55">
          <Sparkle size={15} />
          ONE CONTINUOUS CONVERSATION
        </div>
        <h1 className="mt-7 max-w-[15ch] text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white md:text-6xl lg:text-[4.6rem]">
          角色在这里继续生活，对话不必重新开始。
        </h1>
        <p className="mt-7 max-w-[58ch] text-pretty text-base leading-7 text-white/52">
          创建一个角色，或回到已有会话。Echoo 会把模型运行、消息与状态留在同一条清晰的时间线上。
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <button className="flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#09090b] transition hover:bg-white/88 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-px" onClick={onCreateAgent}>
            <Plus size={17} weight="bold" />创建角色
          </button>
          <button className="flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-white/58 transition hover:bg-white/[0.045] hover:text-white active:translate-y-px" onClick={onOpenChat}>
            打开会话<ArrowRight size={17} />
          </button>
        </div>
      </div>

      <div className="relative mt-16 grid border-t border-white/[0.07] md:grid-cols-2">
        <article className="py-7 md:pr-10">
          <Brain className="text-white/70" size={23} weight="duotone" />
          <h2 className="mt-5 text-lg font-semibold text-white/92">本初角色</h2>
          <p className="mt-2 max-w-[44ch] text-sm leading-6 text-white/45">拥有持续状态、记忆、日程与自主沉默，适合需要长期变化的关系。</p>
        </article>
        <article className="border-t border-white/[0.07] py-7 md:border-l md:border-t-0 md:pl-10">
          <ChatCircleDots className="text-white/70" size={23} weight="duotone" />
          <h2 className="mt-5 text-lg font-semibold text-white/92">切片角色</h2>
          <p className="mt-2 max-w-[44ch] text-sm leading-6 text-white/45">保持明确的人设与对话上下文，适合片段场景和直接、轻量的交流。</p>
        </article>
      </div>
    </section>
  );
}
