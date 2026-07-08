import { Waveform } from "@phosphor-icons/react";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  status?: string;
  kind?: string;
}

export function MessageBubble({ message }: { message: MessageBubbleModel }) {
  const mine = message.from === "me";

  if (message.kind === "voice") {
    return (
      <div className="flex max-w-[85%] items-center gap-3 self-start md:max-w-[70%]">
        <div className="h-8 w-8 rounded-full border border-white/10 bg-white/[0.04]" />
        <div className="flex items-center gap-3 py-2 text-white">
          <Waveform size={23} weight="duotone" />
          <div className="flex items-center gap-1">
            {[16, 24, 12, 20, 8].map((height, index) => (
              <span key={index} className="w-1 rounded-full bg-white/70" style={{ height }} />
            ))}
          </div>
          <span className="text-xs text-white/45">{message.text}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex max-w-[85%] items-start gap-3 md:max-w-[70%] ${mine ? "self-end" : "self-start"}`}>
      {!mine ? <div className="h-8 w-8 flex-shrink-0 rounded-full border border-white/10 bg-white/[0.04]" /> : null}
      <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
            mine
              ? "rounded-tr-sm border border-white/8 bg-white/[0.08] text-white"
              : "rounded-tl-sm border border-white/8 bg-white/[0.03] text-white/82 backdrop-blur-xl"
          }`}
        >
          {message.text}
        </div>
        {message.status ? <span className="mr-1 text-[10px] text-white/30">{message.status}</span> : null}
      </div>
      {mine ? <div className="h-8 w-8 flex-shrink-0 rounded-full border border-white/10 bg-white/[0.04]" /> : null}
    </div>
  );
}
