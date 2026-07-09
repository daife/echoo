import { ArrowCounterClockwise, Waveform } from "@phosphor-icons/react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  status?: string;
  kind?: string;
  canRollback?: boolean;
}

export function MessageBubble({
  message,
  onRetry,
  onRollback
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
        onContextMenu: handleContextMenu
      }
    : {};

  const actionMenu = canRollback && isActionOpen ? (
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

  if (message.kind === "voice") {
    return (
      <div className="relative flex max-w-[85%] items-center gap-3 self-start md:max-w-[70%]" {...longPressProps}>
        {actionMenu}
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
    <div
      className={`relative flex max-w-[85%] items-start gap-3 md:max-w-[70%] ${mine ? "self-end" : "self-start"}`}
      {...longPressProps}
    >
      {actionMenu}
      {!mine ? <div className="h-8 w-8 flex-shrink-0 rounded-full border border-white/10 bg-white/[0.04]" /> : null}
      {canRetry ? (
        <button
          className="mt-1 rounded-full border border-red-300/25 px-3 py-1.5 text-[11px] font-medium text-red-100/80 transition hover:border-red-200/45 hover:text-red-50 active:scale-95"
          type="button"
          onClick={() => onRetry(message.id)}
        >
          重试
        </button>
      ) : null}
      <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
            mine
              ? message.status === "failed"
                ? "rounded-tr-sm border border-red-300/20 bg-red-400/[0.08] text-red-50"
                : "rounded-tr-sm border border-white/8 bg-white/[0.08] text-white"
              : "rounded-tl-sm border border-white/8 bg-white/[0.03] text-white/82 backdrop-blur-xl"
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
        {message.status ? <span className="mr-1 text-[10px] text-white/30">{message.status}</span> : null}
      </div>
      {mine ? <div className="h-8 w-8 flex-shrink-0 rounded-full border border-white/10 bg-white/[0.04]" /> : null}
    </div>
  );
}
