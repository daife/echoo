import { Microphone, PaperPlaneRight, Paperclip, Plus, Waveform } from "@phosphor-icons/react";
import type { Agent, LocalMessage } from "@echoo/shared";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initApp } from "../../app/bootstrap/initApp";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import { MessageBubble, type MessageBubbleModel } from "../../features/messages/components/MessageBubble";

export function MessagesPage({ agent }: { agent?: Agent }) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const conversationId = agent?.conversationId;
  const title = agent?.name ?? "Choose an agent";
  const subtitle = agent ? `${agent.type === "slice" ? "Slice" : "Core"} agent, online now` : "Open or create an agent to start chatting";
  const prologueHtml = agent?.prologueHtml ?? "";

  const refreshLocalMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await services.messageService.listLocalMessages(conversationId));
  }, [conversationId, services.messageService]);

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void refreshLocalMessages()
      .then(() => services.messageService.syncConversationMessages(conversationId))
      .then(() => {
        if (!cancelled) return refreshLocalMessages();
        return undefined;
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load messages.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshLocalMessages, services.messageService]);

  useEffect(() => {
    if (!conversationId) return;

    void runtime.message.startRealtime();
    return runtime.message.onMessageCreated((message) => {
      if (message.conversationId !== conversationId) return;
      void services.messageService.ingestRealtimeMessage(message).then(refreshLocalMessages);
    });
  }, [conversationId, refreshLocalMessages, runtime.message, services.messageService]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isSending]);

  const visibleMessages = useMemo(() => {
    if (messages.length > 0) return messages.map(toBubbleMessage);
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
  }, [agent, messages]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || isSending) return;

    const clientMessageId = `client_${crypto.randomUUID()}`;
    const now = Date.now();
    const pending: LocalMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId: "me",
      role: "user",
      direction: "outgoing",
      contentType: "text",
      content: { text },
      status: "pending",
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending"
    };

    setDraft("");
    setError(null);
    setIsSending(true);
    setMessages((current) => [...current.filter((message) => message.id !== clientMessageId), pending]);

    try {
      await services.messageService.sendTextMessage({ conversationId, text, clientMessageId });
      await refreshLocalMessages();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
      await refreshLocalMessages();
    } finally {
      setIsSending(false);
    }
  };

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
      <header className="flex items-center justify-between border-b border-white/8 p-5">
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
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:border-white/20 hover:text-white active:scale-95"
          disabled={isLoading}
          onClick={() => void services.messageService.syncConversationMessages(agent.conversationId).then(refreshLocalMessages)}
        >
          {isLoading ? "Syncing" : "Sync"}
        </button>
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
          <MessageBubble key={message.id} message={message} />
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

function toBubbleMessage(message: LocalMessage): MessageBubbleModel {
  return {
    id: message.id,
    from: message.direction === "outgoing" ? "me" : "agent",
    text: message.content.text ?? "",
    status: message.syncStatus === "pending" ? "sending" : message.status === "failed" ? "failed" : undefined,
    kind: message.contentType === "voice" ? "voice" : undefined
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
