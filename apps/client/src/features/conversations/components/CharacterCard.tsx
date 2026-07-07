import { ArrowUpRight } from "@phosphor-icons/react";

export interface CharacterCardAgent {
  name: string;
  kind: string;
  description: string;
  gradient: string;
}

export function CharacterCard({ agent, onOpenChat }: { agent: CharacterCardAgent; onOpenChat: () => void }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-white/8 bg-[#121214] transition duration-300 hover:border-white/18 hover:bg-[#18181b]">
      <div className={`relative h-56 bg-gradient-to-br ${agent.gradient}`}>
        <div className="absolute inset-x-8 bottom-0 top-10 rounded-t-full border border-white/10 bg-black/20 backdrop-blur-xl" />
        <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
          <div className="h-20 w-20 rounded-full border border-white/20 bg-white/[0.06] shadow-[0_0_38px_rgba(255,255,255,0.12)]" />
          <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-xs text-white/70 backdrop-blur-xl">
            {agent.kind}
          </span>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold text-white">{agent.name}</h3>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/60 transition group-hover:border-white/20 group-hover:text-white active:scale-95"
            onClick={onOpenChat}
            aria-label={`Open ${agent.name}`}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
        <p className="mt-3 min-h-14 text-sm leading-6 text-white/52">{agent.description}</p>
      </div>
    </article>
  );
}
