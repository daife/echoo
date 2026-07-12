import {
  ArrowCounterClockwise,
  SpinnerGap,
  TextAa,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeVoiceTranscript } from "../messagePresentation";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  createdAt: number;
  deliveryState?: "sending" | "failed";
  kind?: "text" | "image" | "voice";
  mediaUrl?: string;
  transcript?: string;
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
  const canRetry = mine && message.deliveryState === "failed" && onRetry;
  const cleanTranscript = useMemo(
    () => sanitizeVoiceTranscript(message.transcript ?? ""),
    [message.transcript],
  );
  const canShowTranscript =
    message.kind === "voice" && Boolean(cleanTranscript);
  const canRollback = Boolean(message.canRollback && onRollback);
  const hasActions = canRollback || canShowTranscript;
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
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
    if (!hasActions) return;
    didLongPressRef.current = true;
    setIsActionOpen(true);
  };

  const handlePointerDown = (_event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasActions) return;
    didLongPressRef.current = false;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(openActions, 520);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!hasActions) return;
    event.preventDefault();
    openActions();
  };

  const longPressProps = hasActions
    ? {
        onPointerDown: handlePointerDown,
        onPointerUp: clearPressTimer,
        onPointerCancel: clearPressTimer,
        onPointerLeave: clearPressTimer,
        onContextMenu: handleContextMenu,
      }
    : {};

  const actionMenu = isActionOpen ? (
    <div
      ref={menuRef}
      className={`absolute -top-12 z-20 flex rounded-xl border border-white/10 bg-[#17171b] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.38)] ${
        mine ? "right-10" : "left-10"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {canShowTranscript ? (
        <button
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white active:scale-95"
          type="button"
          onClick={() => {
            setIsTranscriptOpen((current) => !current);
            setIsActionOpen(false);
          }}
        >
          <TextAa size={14} />
          {isTranscriptOpen ? "收起文字" : "转文字"}
        </button>
      ) : null}
      {canRollback ? (
        <button
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white active:scale-95"
          type="button"
          onClick={() => {
            setIsActionOpen(false);
            onRollback?.(message.id);
          }}
        >
          <ArrowCounterClockwise size={14} />
          回溯
        </button>
      ) : null}
    </div>
  ) : null;

  if (message.kind === "image") {
    const mediaUrl = resolveMediaUrl(message.mediaUrl);
    if (!mediaUrl) return null;
    return (
      <div
        className="relative flex max-w-[85%] items-start gap-3 self-start md:max-w-[70%]"
        {...longPressProps}
      >
        {actionMenu}
        <div className="mt-1 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        <img
          className="max-h-[480px] max-w-[360px] rounded-xl object-cover"
          src={mediaUrl}
          alt="角色发送的图片"
        />
      </div>
    );
  }

  if (message.kind === "voice") {
    const mediaUrl = resolveMediaUrl(message.mediaUrl);
    if (!mediaUrl) return null;
    return (
      <div
        className="relative flex max-w-[85%] items-start gap-3 self-start md:max-w-[70%]"
        {...longPressProps}
      >
        {actionMenu}
        <div className="mt-3 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        <VoiceBubble
          mediaUrl={mediaUrl}
          transcript={isTranscriptOpen ? cleanTranscript : undefined}
          suppressNextClickRef={didLongPressRef}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex max-w-[85%] items-end gap-2 md:max-w-[70%] ${
        mine ? "self-end" : "self-start"
      }`}
      {...longPressProps}
    >
      {actionMenu}
      {mine ? (
        <DeliveryIndicator
          state={message.deliveryState}
          canRetry={Boolean(canRetry)}
          onRetry={() => onRetry?.(message.id)}
        />
      ) : (
        <div className="mb-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
      )}
      <div
        className={`rounded-xl px-4 py-3 text-sm leading-6 ${
          mine
            ? message.deliveryState === "failed"
              ? "border border-red-300/20 bg-red-400/[0.08] text-red-50"
              : "bg-white/[0.09] text-white"
            : "bg-white/[0.035] text-white/82"
        }`}
      >
        {message.text}
      </div>
      {mine ? (
        <div className="mb-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
      ) : null}
    </div>
  );
}

function VoiceBubble({
  mediaUrl,
  transcript,
  suppressNextClickRef,
}: {
  mediaUrl: string;
  transcript?: string;
  suppressNextClickRef: React.MutableRefObject<boolean>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setDuration(0);
    setIsPlaying(false);
  }, [mediaUrl]);

  const toggle = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const seconds = duration > 0 ? Math.max(1, Math.round(duration)) : null;
  const width = Math.min(280, Math.max(148, 142 + (seconds ?? 0) * 3));

  return (
    <div className="min-w-0">
      <button
        className="flex h-12 items-center gap-3 rounded-xl bg-white/[0.055] px-4 text-left text-white transition hover:bg-white/[0.075] active:scale-[0.99]"
        style={{ width }}
        type="button"
        aria-label={isPlaying ? "暂停语音" : "播放语音"}
        onClick={toggle}
      >
        <Waveform
          size={23}
          weight={isPlaying ? "fill" : "duotone"}
          className={isPlaying ? "animate-pulse text-white" : "text-white/75"}
        />
        <span className="ml-auto text-xs tabular-nums text-white/48">
          {seconds ? `${seconds}″` : "语音"}
        </span>
      </button>
      <audio
        ref={audioRef}
        className="hidden"
        preload="metadata"
        src={mediaUrl}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      {transcript ? (
        <p className="mt-2 max-w-[320px] rounded-xl bg-white/[0.035] px-3.5 py-2.5 text-sm leading-6 text-white/72">
          {transcript}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryIndicator({
  state,
  canRetry,
  onRetry,
}: {
  state?: "sending" | "failed";
  canRetry: boolean;
  onRetry: () => void;
}) {
  if (state === "sending") {
    return (
      <span
        className="mb-1 grid h-7 w-7 place-items-center text-white/38"
        aria-label="发送中"
      >
        <SpinnerGap className="animate-spin" size={16} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <button
        className="mb-1 grid h-7 w-7 place-items-center rounded-full text-red-300/80 transition hover:bg-red-400/10 hover:text-red-200 disabled:cursor-default"
        type="button"
        disabled={!canRetry}
        aria-label="发送失败，点击重试"
        onClick={onRetry}
      >
        <WarningCircle size={18} weight="fill" />
      </button>
    );
  }
  return null;
}

function resolveMediaUrl(mediaUrl?: string) {
  if (!mediaUrl) return undefined;
  if (/^https?:\/\//.test(mediaUrl)) return mediaUrl;
  const apiBase =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  return new URL(mediaUrl, new URL(apiBase).origin).toString();
}
