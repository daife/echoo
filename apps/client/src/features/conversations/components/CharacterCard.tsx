import { ArrowUpRight } from "@phosphor-icons/react";
import type { AgentAttribute } from "@echoo/shared";
import { MediaAsset } from "../../media/MediaAsset";
import { IdentityAvatar } from "../../../shared/components/IdentityAvatar";

export interface CharacterCardAgent {
  id?: string;
  name: string;
  kind: string;
  description: string;
  gradient: string;
  avatarResourcePath?: string;
  coverResourcePath?: string;
  attributes?: AgentAttribute[];
  tags?: string[];
}

export function CharacterCard({
  agent,
  onOpenChat,
}: {
  agent: CharacterCardAgent;
  onOpenChat: (agent: CharacterCardAgent) => void;
}) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-white/8 bg-[#121214] transition duration-300 hover:border-white/18 hover:bg-[#18181b]">
      <div
        className={`relative h-56 overflow-hidden bg-gradient-to-br ${agent.gradient}`}
      >
        {agent.coverResourcePath ? (
          <MediaAsset
            className="absolute inset-0 h-full w-full object-cover opacity-70"
            mediaUrl={agent.coverResourcePath}
            variant="display"
            alt=""
          />
        ) : null}
        <div className="absolute inset-x-8 bottom-0 top-10 rounded-t-full border border-white/10 bg-black/20 backdrop-blur-xl" />
        <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
          <IdentityAvatar
            mediaUrl={agent.avatarResourcePath}
            alt={agent.name}
            className="h-20 w-20 border-white/20 bg-white/[0.06] shadow-[0_0_38px_rgba(255,255,255,0.12)]"
          />
          <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-xs text-white/70 backdrop-blur-xl">
            {agent.kind}
          </span>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-2xl font-semibold text-white">{agent.name}</h3>
          <div className="flex shrink-0 items-start gap-2">
            {agent.attributes?.length ? (
              <div className="hidden max-w-40 flex-wrap justify-end gap-1.5 sm:flex">
                {agent.attributes.slice(0, 2).map((attribute) => (
                  <span
                    key={`${attribute.key}-${attribute.value}`}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-white/55"
                  >
                    {attribute.key}: {attribute.value}
                  </span>
                ))}
              </div>
            ) : null}
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/60 transition group-hover:border-white/20 group-hover:text-white active:scale-95"
              onClick={() => onOpenChat(agent)}
              aria-label={`打开 ${agent.name}`}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
        <p className="mt-3 min-h-14 text-sm leading-6 text-white/52">
          {agent.description}
        </p>
        {agent.tags?.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {agent.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/50"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
