import { MagnifyingGlass, Robot } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";

const conversations = [
  { name: "Aster", text: "我已经把今天的待办拆成三段。", unread: 3 },
  { name: "Mira", text: "我们可以先保存这个片段，明天继续。", unread: 1 },
  { name: "Noir", text: "我把这段信息整理成了三个可执行步骤。", unread: 2 },
  { name: "Lyra", text: "我把你的语气偏好记下来了。", unread: 0 }
];

export function ConversationRail({
  agents,
  onOpenAgent,
  onOpenChat
}: {
  agents: Agent[];
  onOpenAgent: (agent: Agent) => void;
  onOpenChat: () => void;
}) {
  const visibleConversations =
    agents.length > 0
      ? agents.map((agent) => ({ name: agent.name, text: agent.introduction || agent.persona, unread: 0, agent }))
      : conversations.map((conversation) => ({ ...conversation, agent: null }));

  return (
    <aside className="hidden min-w-0 md:block">
      <div className="glass-panel sticky top-24 overflow-hidden rounded-2xl">
        <div className="border-b border-white/8 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Conversations</h2>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#09090b]">{visibleConversations.length}</span>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.025] px-4 py-3 text-white/45">
            <MagnifyingGlass size={17} />
            <span className="text-sm">Search agents and memories</span>
          </div>
        </div>
        <div className="max-h-[calc(100dvh-220px)] overflow-y-auto p-2 no-scrollbar">
          {visibleConversations.map((conversation) => {
            return (
              <button
                key={conversation.name}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-white/[0.045] active:scale-[0.99]"
                onClick={() => (conversation.agent ? onOpenAgent(conversation.agent) : onOpenChat())}
              >
                <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
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
