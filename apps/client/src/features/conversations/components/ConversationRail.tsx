import { Robot } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";

export function ConversationRail({
  agents,
  onOpenAgent,
  onOpenChat
}: {
  agents: Agent[];
  onOpenAgent: (agent: Agent) => void;
  onOpenChat: () => void;
}) {
  const visibleConversations = agents.map((agent) => ({ name: agent.name,
    text: agent.introduction || getAgentFallbackText(agent), unread: 0, agent }));

  return (
    <aside className="hidden min-w-0 md:block">
      <div className="sticky top-24 overflow-hidden rounded-xl bg-[#0d0d10]/72">
        <div className="border-b border-white/8 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-[-0.015em] text-white">会话</h2>
            <span className="font-mono text-xs tabular-nums text-white/42">{String(visibleConversations.length).padStart(2, "0")}</span>
          </div>
        </div>
        <div className="max-h-[calc(100dvh-220px)] overflow-y-auto p-2 no-scrollbar">
          {!visibleConversations.length ? <div className="px-4 py-12 text-center"><Robot className="mx-auto text-white/35" size={24} /><p className="mt-3 text-sm text-white/42">创建角色后，会话会出现在这里。</p></div> : null}
          {visibleConversations.map((conversation) => {
            return (
              <button
                key={conversation.name}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-white/[0.055] active:translate-y-px"
                onClick={() => (conversation.agent ? onOpenAgent(conversation.agent) : onOpenChat())}
              >
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-white/[0.06] text-white/75">
                  <Robot size={19} weight="duotone" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-white">{conversation.name}</div>
                    {conversation.unread > 0 ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#09090b]">
                        {conversation.unread}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-white/42">{conversation.text}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function getAgentFallbackText(agent: Agent) {
  return agent.type === "slice-figure" ? agent.detail.persona : "";
}
