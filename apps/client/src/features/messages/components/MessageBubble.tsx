import { ArrowCounterClockwise, Waveform } from "@phosphor-icons/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useRef, useState } from "react";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  status?: string;
  kind?: string;
  mediaUrl?: string;
  canRollback?: boolean;
}

export function MessageBubble({
  message,
  onRetry,
  onRollback,
}: {
  message: MessageBubbleModel;
  onRetry?: (messageId: string) => void;
  onRollback?: (messageId: string) => void;
}) {
  const mine = message.from === "me";
  const canRetry = mine && message.status === "failed" && onRetry;
  const canRollback = Boolean(message.canRollback && onRollback);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  useEffect(() => clearPressTimer, []);

  useEffect(() => {
    if (!isActionOpen) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setIsActionOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [isActionOpen]);

  const openActions = () => {
    if (!canRollback) return;
    setIsActionOpen(true);
  };

  const handlePointerDown = (_event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canRollback) return;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(openActions, 520);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!canRollback) return;
    event.preventDefault();
    openActions();
  };

  const longPressProps = canRollback
    ? {
        onPointerDown: handlePointerDown,
        onPointerUp: clearPressTimer,
        onPointerCancel: clearPressTimer,
        onPointerLeave: clearPressTimer,
        onContextMenu: handleContextMenu,
      }
    : {};

  const actionMenu =
    canRollback && isActionOpen ? (
      <div
        ref={menuRef}
        className={`absolute -top-11 z-20 rounded-xl border border-white/10 bg-[#17171b] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.38)] ${
          mine ? "right-10" : "left-10"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white active:scale-95"
          type="button"
          onClick={() => {
            setIsActionOpen(false);
            onRollback?.(message.id);
          }}
        >
          <ArrowCounterClockwise size={14} />
          回溯
        </button>
      </div>
    ) : null;

  if (message.kind === "image") {
    const mediaUrl = resolveMediaUrl(message.mediaUrl);
    return (
      <div
        className="relative flex max-w-[85%] items-start gap-3 self-start md:max-w-[70%]"
        {...longPressProps}
      >
        {actionMenu}
        <div className="mt-1 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        <div className="flex max-w-[360px] flex-col gap-2 overflow-hidden rounded-xl bg-white/[0.035] p-2 text-white/82">
          {mediaUrl ? (
            <img
              className="max-h-[480px] w-full rounded-xl object-cover"
              src={mediaUrl}
              alt={message.text || "角色发送的图片"}
            />
          ) : (
            <div className="flex aspect-[3/4] w-[240px] max-w-full items-center justify-center rounded-xl bg-white/[0.04] text-xs text-white/35">
              {message.status === "typing" ? "正在生成图片…" : "图片生成失败"}
            </div>
          )}
          {message.text ? (
            <p className="px-1 pb-1 text-xs leading-5 text-white/55">
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (message.kind === "voice") {
    const mediaUrl = resolveMediaUrl(message.mediaUrl);
    return (
      <div
        className="relative flex max-w-[85%] items-center gap-3 self-start md:max-w-[70%]"
        {...longPressProps}
      >
        {actionMenu}
        <div className="h-7 w-1 rounded-full bg-white/25" />
        <div className="flex min-w-0 flex-col gap-2 py-2 text-white">
          <div className="flex items-center gap-3">
            <Waveform size={23} weight="duotone" />
            <div className="flex items-center gap-1">
              {[16, 24, 12, 20, 8].map((height, index) => (
                <span
                  key={index}
                  className="w-1 rounded-full bg-white/70"
                  style={{ height }}
                />
              ))}
            </div>
            <span className="text-xs leading-5 text-white/55">
              {message.text ||
                (message.status === "typing" ? "正在生成语音…" : "语音")}
            </span>
          </div>
          {mediaUrl ? (
            <audio
              className="h-8 w-[260px] max-w-full"
              controls
              preload="metadata"
              src={mediaUrl}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex max-w-[85%] items-start gap-3 md:max-w-[70%] ${mine ? "self-end" : "self-start"}`}
      {...longPressProps}
    >
      {actionMenu}
      {!mine ? (
        <div className="mt-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
      ) : null}
      {canRetry ? (
        <button
          className="mt-1 rounded-full border border-red-300/25 px-3 py-1.5 text-[11px] font-medium text-red-100/80 transition hover:border-red-200/45 hover:text-red-50 active:scale-95"
          type="button"
          onClick={() => onRetry(message.id)}
        >
          重试
        </button>
      ) : null}
      <div
        className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}
      >
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-6 ${
            mine
              ? message.status === "failed"
                ? "border border-red-300/20 bg-red-400/[0.08] text-red-50"
                : "bg-white/[0.09] text-white"
              : "bg-white/[0.035] text-white/82"
          }`}
        >
          {message.status === "typing" && !message.text ? (
            <div className="flex h-6 items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/35 [animation-delay:300ms]" />
            </div>
          ) : (
            message.text
          )}
        </div>
        {message.status ? (
          <span className="mr-1 text-[10px] text-white/30">
            {formatMessageStatus(message.status)}
          </span>
        ) : null}
      </div>
      {mine ? (
        <div className="mt-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
      ) : null}
    </div>
  );
}

function resolveMediaUrl(mediaUrl?: string) {
  if (!mediaUrl) return undefined;
  if (/^https?:\/\//.test(mediaUrl)) return mediaUrl;
  const apiBase =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  return new URL(mediaUrl, new URL(apiBase).origin).toString();
}

function formatMessageStatus(status: string) {
  if (status === "sending") return "发送中";
  if (status === "typing") return "输入中";
  if (status === "failed") return "失败";
  return status;
}
