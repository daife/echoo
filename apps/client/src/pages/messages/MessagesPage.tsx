import { GearSix, Microphone, PaperPlaneRight, Paperclip, Plus, Waveform, X } from "@phosphor-icons/react";
import type { Agent, LocalMessage } from "@echoo/shared";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initApp } from "../../app/bootstrap/initApp";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import { MessageBubble, type MessageBubbleModel } from "../../features/messages/components/MessageBubble";

interface StreamDisplayBuffer {
  chars: string[];
  timerId: number | null;
  charsPerSecond: number;
  lastDeltaAt: number;
  completedMessage?: LocalMessage;
}

interface ConversationSettings {
  streamEnabled: boolean;
}

const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
  streamEnabled: true
};

export function MessagesPage({ agent }: { agent?: Agent }) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [conversationSettings, setConversationSettings] = useState<ConversationSettings>(DEFAULT_CONVERSATION_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  const streamBuffersRef = useRef(new Map<string, StreamDisplayBuffer>());
  const conversationId = agent?.conversationId;
  const title = agent?.name ?? "Choose an agent";
  const subtitle = agent ? `${agent.type === "slice" ? "Slice" : "Core"} agent, online now` : "Open or create an agent to start chatting";
  const prologueHtml = agent?.prologueHtml ?? "";

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshLocalMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await services.messageService.listLocalMessages(conversationId));
  }, [conversationId, services.messageService]);

  useEffect(() => {
    if (!conversationId) {
      setConversationSettings(DEFAULT_CONVERSATION_SETTINGS);
      setIsSettingsOpen(false);
      return;
    }

    let cancelled = false;
    void runtime.storage.getSetting<ConversationSettings>(getConversationSettingsKey(conversationId)).then((settings) => {
      if (cancelled) return;
      setConversationSettings({ ...DEFAULT_CONVERSATION_SETTINGS, ...(settings ?? {}) });
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId, runtime.storage]);

  const updateConversationSettings = useCallback(
    async (settings: ConversationSettings) => {
      if (!conversationId) return;
      setConversationSettings(settings);
      await runtime.storage.setSetting(getConversationSettingsKey(conversationId), settings);
    },
    [conversationId, runtime.storage]
  );

  const scheduleStreamDrain = useCallback((messageId: string) => {
    const buffer = streamBuffersRef.current.get(messageId);
    if (!buffer || buffer.timerId !== null) return;

    const drain = () => {
      const currentBuffer = streamBuffersRef.current.get(messageId);
      if (!currentBuffer) return;

      const nextChar = currentBuffer.chars.shift();
      if (nextChar) {
        setMessages((current) => appendMessageDelta(current, messageId, nextChar, Date.now()));
      }

      if (currentBuffer.chars.length === 0) {
        currentBuffer.timerId = null;
        if (currentBuffer.completedMessage) {
          setMessages((current) => mergeLocalMessage(current, currentBuffer.completedMessage as LocalMessage));
          streamBuffersRef.current.delete(messageId);
        }
        return;
      }

      currentBuffer.timerId = window.setTimeout(drain, getStreamDrainDelay(currentBuffer));
    };

    buffer.timerId = window.setTimeout(drain, getStreamDrainDelay(buffer));
  }, []);

  const enqueueDisplayDelta = useCallback(
    (messageId: string, delta: string) => {
      const now = performance.now();
      const buffer =
        streamBuffersRef.current.get(messageId) ??
        {
          chars: [],
          timerId: null,
          charsPerSecond: 28,
          lastDeltaAt: now
        };
      const chars = Array.from(delta);
      const elapsedSeconds = Math.max((now - buffer.lastDeltaAt) / 1000, 0.08);
      const observedCharsPerSecond = chars.length / elapsedSeconds;

      buffer.chars.push(...chars);
      buffer.charsPerSecond = clamp(buffer.charsPerSecond * 0.7 + observedCharsPerSecond * 0.3, 14, 90);
      buffer.lastDeltaAt = now;
      streamBuffersRef.current.set(messageId, buffer);
      scheduleStreamDrain(messageId);
    },
    [scheduleStreamDrain]
  );

  const completeStreamedMessage = useCallback(
    (message: LocalMessage) => {
      const displayed = messagesRef.current.find((item) => item.id === message.id)?.content.text ?? "";
      const finalText = message.content.text ?? "";
      const buffer =
        streamBuffersRef.current.get(message.id) ??
        {
          chars: [],
          timerId: null,
          charsPerSecond: 32,
          lastDeltaAt: performance.now()
        };

      if (finalText.startsWith(displayed)) {
        const missingText = finalText.slice(displayed.length);
        if (missingText) buffer.chars.push(...Array.from(missingText));
        buffer.completedMessage = message;
        streamBuffersRef.current.set(message.id, buffer);
        scheduleStreamDrain(message.id);
        return;
      }

      setMessages((current) => mergeLocalMessage(current, message));
      streamBuffersRef.current.delete(message.id);
    },
    [scheduleStreamDrain]
  );

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setError(null);

    void refreshLocalMessages()
      .then(() => services.messageService.syncConversationMessages(conversationId))
      .then(() => {
        if (!cancelled) return refreshLocalMessages();
        return undefined;
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load messages.");
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshLocalMessages, services.messageService]);

  useEffect(() => {
    return () => {
      streamBuffersRef.current.forEach((buffer) => {
        if (buffer.timerId !== null) window.clearTimeout(buffer.timerId);
      });
      streamBuffersRef.current.clear();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    void runtime.message.startRealtime();
    const unsubscribeCreated = runtime.message.onMessageCreated((message) => {
      if (message.conversationId !== conversationId) return;
      void services.messageService.ingestRealtimeMessage(message);
      setMessages((current) => mergeIncomingMessage(current, { ...message, syncStatus: "synced" }));
    });
    const unsubscribeDelta = runtime.message.onMessageDelta((event) => {
      if (event.conversationId !== conversationId) return;
      void services.messageService.ingestRealtimeDelta(event);
      enqueueDisplayDelta(event.messageId, event.delta);
    });
    const unsubscribeCompleted = runtime.message.onMessageCompleted((message) => {
      if (message.conversationId !== conversationId) return;
      void services.messageService.ingestRealtimeCompleted(message);
      completeStreamedMessage({ ...message, syncStatus: "synced" });
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDelta();
      unsubscribeCompleted();
    };
  }, [completeStreamedMessage, conversationId, enqueueDisplayDelta, runtime.message, services.messageService]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

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
      const result = await services.messageService.sendTextMessage({
        conversationId,
        text,
        clientMessageId,
        stream: conversationSettings.streamEnabled
      });
      setMessages((current) => {
        const withUserMessage = mergeLocalMessage(current.filter((message) => message.id !== clientMessageId), {
          ...result.message,
          syncStatus: "synced"
        });
        return result.assistantMessage
          ? mergeIncomingMessage(withUserMessage, { ...result.assistantMessage, syncStatus: "synced" })
          : withUserMessage;
      });
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
    status:
      message.syncStatus === "pending"
        ? "sending"
        : message.status === "pending" && message.role === "assistant"
          ? "typing"
          : message.status === "failed"
            ? "failed"
            : undefined,
    kind: message.contentType === "voice" ? "voice" : undefined
  };
}

function mergeLocalMessage(messages: LocalMessage[], message: LocalMessage) {
  return [...messages.filter((item) => item.id !== message.id), message].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt - right.createdAt
  );
}

function mergeIncomingMessage(messages: LocalMessage[], message: LocalMessage) {
  const existing = messages.find((item) => item.id === message.id);
  const incomingText = message.content.text ?? "";
  const existingText = existing?.content.text ?? "";

  if (existing && message.status === "pending" && !incomingText && existingText) {
    return mergeLocalMessage(messages, {
      ...message,
      content: {
        ...message.content,
        text: existingText
      },
      updatedAt: Math.max(existing.updatedAt, message.updatedAt)
    });
  }

  return mergeLocalMessage(messages, message);
}

function appendMessageDelta(messages: LocalMessage[], messageId: string, delta: string, updatedAt: number) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;

    return {
      ...message,
      content: {
        ...message.content,
        text: `${message.content.text ?? ""}${delta}`
      },
      status: "pending" as const,
      updatedAt
    };
  });
}

function getStreamDrainDelay(buffer: StreamDisplayBuffer) {
  const backlogBoost = buffer.chars.length > 120 ? 2.1 : buffer.chars.length > 60 ? 1.65 : buffer.chars.length > 24 ? 1.3 : 1;
  const charactersPerSecond = clamp(buffer.charsPerSecond * backlogBoost, 12, 120);
  return clamp(Math.round(1000 / charactersPerSecond), 8, 90);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getConversationSettingsKey(conversationId: string) {
  return `conversation.settings.${conversationId}`;
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
