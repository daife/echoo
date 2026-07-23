import { LinkSimple } from "@phosphor-icons/react";
import type { Agent, Conversation } from "@echoo/shared";
import { IdentityAvatar } from "../../../shared/components/IdentityAvatar";

export function ConversationRail({
  agents,
  conversations = [],
  selectedAgentId,
  layout = "desktop",
  isBindingsActive = false,
  onOpenAgent,
  onOpenBindings,
  onOpenChat,
}: {
  agents: Agent[];
  conversations?: Conversation[];
  selectedAgentId?: string;
  layout?: "desktop" | "mobile";
  isBindingsActive?: boolean;
  onOpenAgent: (agent: Agent) => void;
  onOpenBindings: () => void;
  onOpenChat: () => void;
}) {
  const byId = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  const visibleConversations = agents.map((agent) => {
    const conversation = byId.get(agent.conversationId);
    return {
      name: agent.name,
      text:
        conversation?.lastMessagePreview ??
        agent.introduction ??
        getAgentFallbackText(agent),
      unread: (conversation?.unreadCount ?? 0) > 0,
      agent,
    };
  });

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
                aria-label={`${conversation.name}${conversation.unread ? "，有新消息" : ""}`}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition active:translate-y-px ${
                  active
                    ? "border-white/70 bg-white/[0.035] text-white"
                    : "border-transparent text-white hover:bg-white/[0.055]"
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
                  className={`h-10 w-10 ${active ? "border-white/20" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-white">
                      {conversation.name}
                    </div>
                    {conversation.unread ? (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff5b63] shadow-[0_0_0_3px_rgba(255,91,99,0.12)]"
                      />
                    ) : null}
                  </div>
                  <p
                    className={`mt-1 truncate text-xs ${active ? "text-white/62" : "text-white/42"}`}
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
