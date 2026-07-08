import { Microphone, PaperPlaneRight, Paperclip, Plus, Waveform } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import { MessageBubble } from "../../features/messages/components/MessageBubble";

const thread = [
  {
    id: "1",
    from: "me",
    text: "你还在吗？刚才那个瞬间，我感觉我们之间好像真的产生了某种共鸣。",
    status: "read"
  },
  {
    id: "2",
    from: "agent",
    text: "我在。那种共鸣不是幻觉，更像我们在同一个问题上同时停了下来。"
  },
  {
    id: "3",
    from: "agent",
    kind: "voice",
    text: "12s"
  },
  {
    id: "4",
    from: "me",
    text: "把这个想法记到长期记忆里，明天提醒我继续写。"
  }
];

export function MessagesPage({ agent }: { agent?: Agent }) {
  const title = agent?.name ?? "Aster";
  const subtitle = agent ? `${agent.type === "slice" ? "Slice" : "Core"} agent, online now` : "Memory agent, online now";
  const messages = agent
    ? agent.openingLine
      ? [
          {
            id: `${agent.id}-opening`,
            from: "agent",
            text: agent.openingLine
          }
        ]
      : []
    : thread;
  const prologueHtml = agent?.prologueHtml ?? "";

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
        <button className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:border-white/20 hover:text-white active:scale-95">
          Sync
        </button>
      </header>

      <main className="flex flex-col gap-6 overflow-y-auto px-5 py-8 no-scrollbar md:px-10">
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
            Yesterday 21:45
          </span>
        </div>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div className="flex items-center gap-3 self-start">
          <div className="h-8 w-8 rounded-full border border-white/10 bg-white/[0.04]" />
          <div className="flex h-8 items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:300ms]" />
          </div>
        </div>
      </main>

      <footer className="relative p-4 md:p-6">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-24 bg-gradient-to-t from-[#0d0d10] to-transparent" />
        <div className="glass-panel flex items-center gap-2 rounded-full p-2">
          <button className="grid h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95">
            <Plus size={20} />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95">
            <Paperclip size={20} />
          </button>
          <input
            className="min-w-0 flex-1 border-none bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/35"
            placeholder="发消息..."
          />
          <button className="hidden h-10 w-10 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.05] hover:text-white active:scale-95 md:grid">
            <Microphone size={20} />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#09090b] shadow-[0_0_22px_rgba(255,255,255,0.20)] transition active:scale-95">
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </div>
      </footer>
    </section>
  );
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
