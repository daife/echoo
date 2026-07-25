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
  onOpenDetail,
}: {
  agent: CharacterCardAgent;
  onOpenChat: (agent: CharacterCardAgent) => void;
  onOpenDetail?: () => void;
}) {
  const identity = (
    <>
      <div
        className={`relative isolate aspect-[16/10] min-h-48 overflow-hidden bg-gradient-to-br ${agent.gradient}`}
      >
        {agent.coverResourcePath ? (
          <MediaAsset
            className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-[1.02] group-hover:opacity-80"
            containerClassName="absolute inset-0 overflow-hidden"
            mediaUrl={agent.coverResourcePath}
            variant="display"
            alt=""
          />
        ) : null}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#121214] via-transparent to-black/10" />
        <div
          className="absolute inset-x-0 bottom-0 z-20 p-5"
          data-character-card-avatar-anchor
        >
          <IdentityAvatar
            mediaUrl={agent.avatarResourcePath}
            alt={agent.name}
            className="h-20 w-20 border-white/20 bg-[#17171c] shadow-[0_16px_38px_rgba(0,0,0,0.32)]"
          />
        </div>
      </div>
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-2xl font-semibold text-white">{agent.name}</h3>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-white/55">
            {agent.kind}
          </span>
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/52">
          {agent.description}
        </p>
        {agent.attributes?.length || agent.tags?.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {agent.attributes?.slice(0, 2).map((attribute) => (
              <span
                key={`${attribute.key}-${attribute.value}`}
                className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-white/55"
              >
                {attribute.key}: {attribute.value}
              </span>
            ))}
            {agent.tags?.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[#aaa0c7]/25 bg-[#aaa0c7]/[0.08] px-2.5 py-1 text-[11px] text-[#c7b9ed]"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <article className="group overflow-hidden rounded-2xl border border-white/8 bg-[#121214] transition duration-300 hover:border-white/18 hover:bg-[#151518]">
      {onOpenDetail ? (
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label={`查看 ${agent.name} 的公共创作详情`}
          className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#c7b9ed]"
        >
          {identity}
        </button>
      ) : (
        <div>{identity}</div>
      )}
      <div className="flex justify-end border-t border-white/8 px-5 py-4">
        <button
          type="button"
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-[#09090b] transition hover:bg-white/90 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={() => onOpenChat(agent)}
          aria-label={`进入与 ${agent.name} 的会话`}
        >
          进入会话
          <ArrowUpRight size={15} weight="bold" />
        </button>
      </div>
    </article>
  );
}
