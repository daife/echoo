import { LinkSimple } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import { IdentityAvatar } from "../../../shared/components/IdentityAvatar";

export function ConversationRail({
  agents,
  selectedAgentId,
  layout = "desktop",
  isBindingsActive = false,
  onOpenAgent,
  onOpenBindings,
  onOpenChat,
}: {
  agents: Agent[];
  selectedAgentId?: string;
  layout?: "desktop" | "mobile";
  isBindingsActive?: boolean;
  onOpenAgent: (agent: Agent) => void;
  onOpenBindings: () => void;
  onOpenChat: () => void;
}) {
  const visibleConversations = agents.map((agent) => ({
    name: agent.name,
    text: agent.introduction || getAgentFallbackText(agent),
    unread: 0,
    agent,
  }));

  return (
    <aside
      className={
        layout === "mobile"
          ? "min-h-0 min-w-0 md:hidden"
          : "hidden min-w-0 md:block"
      }
    >
      <div
        className={
          layout === "mobile"
            ? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-[#0d0d10]/72"
            : "flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-[#0d0d10]/72"
        }
      >
        <div className="border-b border-white/8 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-[-0.015em] text-white">
                会话
              </h2>
              <button
                aria-label="角色接口"
                aria-pressed={isBindingsActive}
                className={`grid h-8 w-8 place-items-center rounded-lg transition active:translate-y-px ${
                  isBindingsActive
                    ? "bg-white text-[#09090b]"
                    : "text-white/42 hover:bg-white/[0.06] hover:text-white"
                }`}
                type="button"
                onClick={onOpenBindings}
              >
                <LinkSimple
                  size={17}
                  weight={isBindingsActive ? "bold" : "regular"}
                />
              </button>
            </div>
            <span className="font-mono text-xs tabular-nums text-white/42">
              {String(visibleConversations.length).padStart(2, "0")}
            </span>
          </div>
        </div>
        <div
          className={
            layout === "mobile"
              ? "min-h-0 flex-1 overflow-y-auto p-2 no-scrollbar"
              : "min-h-0 flex-1 overflow-y-auto p-2 no-scrollbar"
          }
        >
          {!visibleConversations.length ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-white/42">
                创建角色后，会话会出现在这里。
              </p>
            </div>
          ) : null}
          {visibleConversations.map((conversation) => {
            const active = conversation.agent.id === selectedAgentId;
            return (
              <button
                key={conversation.agent.id}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition active:translate-y-px ${
                  active
                    ? "bg-white text-[#09090b]"
                    : "text-white hover:bg-white/[0.055]"
                }`}
                onClick={() =>
                  conversation.agent
                    ? onOpenAgent(conversation.agent)
                    : onOpenChat()
                }
              >
                <IdentityAvatar
                  mediaUrl={conversation.agent.avatarResourcePath}
                  alt={`${conversation.name}的头像`}
                  className={`h-10 w-10 ${active ? "border-black/15" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`truncate text-sm font-medium ${active ? "text-[#09090b]" : "text-white"}`}
                    >
                      {conversation.name}
                    </div>
                    {conversation.unread > 0 ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#09090b]">
                        {conversation.unread}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-1 truncate text-xs ${active ? "text-black/55" : "text-white/42"}`}
                  >
                    {conversation.text}
                  </p>
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
