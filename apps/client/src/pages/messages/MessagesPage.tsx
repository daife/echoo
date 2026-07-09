import { GearSix, Microphone, PaperPlaneRight, Paperclip, Plus, Trash, Waveform, X } from "@phosphor-icons/react";
import type { Agent, LocalMessage } from "@echoo/shared";
import { useEffect, useMemo, useRef } from "react";
import { MessageBubble, type MessageBubbleModel } from "../../features/messages/components/MessageBubble";
import { useConversationMessages } from "./useConversationMessages";

export function MessagesPage({ agent, onConversationDeleted }: { agent?: Agent; onConversationDeleted?: (conversationId: string) => void }) {
  const {
    messages,
    draft,
    setDraft,
    isSending,
    rollingBackMessageId,
    isDeletingConversation,
    isSettingsOpen,
    setIsSettingsOpen,
    conversationSettings,
    updateConversationSettings,
    error,
    canRollback,
    sendMessage,
    retryFailedMessage,
    deleteConversation,
    rollbackConversation
  } = useConversationMessages({ agent, onConversationDeleted });
  const mainRef = useRef<HTMLElement | null>(null);
  const title = agent?.name ?? "Choose a figure";
  const subtitle = agent
    ? `${agent.type === "slice-figure" ? "Slice Figure" : "Prime Figure"}, online now`
    : "Open or create a figure to start chatting";
  const prologueHtml = agent?.prologueHtml ?? "";

  useEffect(() => {
    mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  const visibleMessages = useMemo(() => {
    if (messages.length > 0) return messages.map((message) => toBubbleMessage(message, canRollback));
    if (agent?.openingLine) {
      return [
        {
          id: `${agent.id}-opening`,
          from: "agent",
          text: agent.openingLine
        }
      ];
    }
    return [];
  }, [agent, canRollback, messages]);

  if (!agent) {
    return (
      <section className="grid min-h-[calc(100dvh-8rem)] place-items-center overflow-hidden rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/[0.05]">
            <Waveform size={26} weight="thin" />
          </div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">{subtitle}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-[calc(100dvh-8rem)] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-white/8 bg-[#0d0d10]/80">
      <header className="relative flex items-center justify-between border-b border-white/8 p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/[0.05] shadow-[0_0_26px_rgba(255,255,255,0.10)]">
            <Waveform size={25} weight="thin" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">{title}</h1>
            <p className="text-sm text-white/42">{subtitle}</p>
          </div>
        </div>
        <button
          aria-label="Conversation settings"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/65 transition hover:border-white/20 hover:text-white active:scale-95"
          onClick={() => setIsSettingsOpen((open) => !open)}
        >
          <GearSix size={18} />
        </button>
        {isSettingsOpen ? (
          <div className="absolute right-5 top-[4.25rem] z-30 w-72 rounded-xl border border-white/10 bg-[#121216] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">会话设置</h2>
              <button
                aria-label="Close conversation settings"
                className="grid h-8 w-8 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => setIsSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3">
              <div>
                <div className="text-sm font-medium text-white/88">启用流式传输</div>
                <div className="mt-1 text-xs leading-5 text-white/38">开启后 AI 回复会边生成边显示。</div>
              </div>
              <input
                checked={conversationSettings.streamEnabled}
                className="h-5 w-5 accent-white"
                type="checkbox"
                onChange={(event) =>
                  void updateConversationSettings({
                    ...conversationSettings,
                    streamEnabled: event.target.checked
                  })
                }
              />
            </label>
            <button
              className="mt-3 flex w-full items-center justify-between gap-4 rounded-lg border border-red-300/20 bg-red-400/[0.06] px-3 py-3 text-left transition hover:border-red-200/35 hover:bg-red-400/[0.09] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isDeletingConversation}
              type="button"
              onClick={deleteConversation}
            >
              <div>
                <div className="text-sm font-medium text-red-50">删除会话</div>
                <div className="mt-1 text-xs leading-5 text-red-100/45">删除本地和远程数据库中的这个会话。</div>
              </div>
              <Trash className="text-red-100/70" size={17} />
            </button>
          </div>
        ) : null}
      </header>

      <main ref={mainRef} className="flex flex-col gap-6 overflow-y-auto px-5 py-8 no-scrollbar md:px-10">
        {prologueHtml ? (
          <iframe
            className="h-[420px] w-full rounded-2xl border border-white/8 bg-transparent"
            sandbox="allow-scripts"
            srcDoc={buildPrologueDocument(prologueHtml)}
            title={`${title} prologue`}
          />
        ) : null}
        <div className="flex justify-center">
          <span className="rounded-full border border-white/8 bg-white/[0.025] px-4 py-1 text-xs uppercase tracking-[0.16em] text-white/30">
            Conversation
          </span>
        </div>
        {visibleMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={{
              ...message,
              status: rollingBackMessageId === message.id ? "回溯中" : message.status
            }}
            onRetry={retryFailedMessage}
            onRollback={canRollback ? rollbackConversation : undefined}
          />
        ))}
        {isSending ? (
          <div className="flex items-center gap-3 self-start">
            <div className="h-8 w-8 rounded-full border border-white/10 bg-white/[0.04]" />
            <div className="flex h-8 items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
        {error ? <div className="self-center rounded-full border border-red-400/20 px-4 py-2 text-xs text-red-200/80">{error}</div> : null}
      </main>

      <footer className="relative p-4 md:p-6">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-24 bg-gradient-to-t from-[#0d0d10] to-transparent" />
        <form className="glass-panel flex items-center gap-2 rounded-full p-2" onSubmit={sendMessage}>
          <button className="grid h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95" type="button">
            <Plus size={20} />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95" type="button">
            <Paperclip size={20} />
          </button>
          <input
            className="min-w-0 flex-1 border-none bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/35"
            disabled={isSending}
            placeholder="发消息..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="hidden h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95 md:grid" type="button">
            <Microphone size={20} />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#09090b] shadow-[0_0_22px_rgba(255,255,255,0.20)] transition active:scale-95 disabled:opacity-45"
            disabled={!draft.trim() || isSending}
            type="submit"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </form>
      </footer>
    </section>
  );
}

function toBubbleMessage(message: LocalMessage, canRollback: boolean): MessageBubbleModel {
  return {
    id: message.id,
    from: message.role === "user" ? "me" : "agent",
    text: message.content.text ?? "",
    status:
      message.syncStatus === "pending"
        ? "sending"
        : message.status === "pending" && message.role === "assistant"
          ? "typing"
          : message.status === "failed"
            ? "failed"
            : undefined,
    kind: message.contentType === "voice" ? "voice" : undefined,
    canRollback
  };
}

function buildPrologueDocument(html: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: transparent;
        color: #f5f1ee;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        overflow-x: hidden;
      }

      img,
      video,
      canvas,
      svg {
        max-width: 100%;
      }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}
