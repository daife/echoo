import {
  ArrowCounterClockwise,
  Check,
  Money,
  PencilSimple,
  SpinnerGap,
  TextAa,
  WarningCircle,
  Waveform,
  X,
} from "@phosphor-icons/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCacheableMediaKey,
  mediaCache,
  resolveMediaUrl,
} from "../../../services/mediaCache";
import {
  sanitizeVoiceTranscript,
  tokenizeParentheticalText,
} from "../messagePresentation";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  createdAt: number;
  deliveryState?: "sending" | "failed";
  kind?:
    | "text"
    | "image"
    | "voice"
    | "sticker"
    | "transfer"
    | "memory-summary"
    | "runtime-error";
  mediaUrl?: string;
  transcript?: string;
  durationSeconds?: number;
  canRollback?: boolean;
  canEdit?: boolean;
  sourceMessageId?: string;
  sourceText?: string;
  isPending?: boolean;
  isSourceStart?: boolean;
  transferAmount?: number;
  transferCurrency?: "CNY";
  transferStatus?: "pending" | "accepted" | "rejected";
  transferDirection?: "received" | "paid";
  transferNote?: string;
}

export function MessageBubble({
  message,
  onRetry,
  onRollback,
  onEdit,
  onResolveTransfer,
}: {
  message: MessageBubbleModel;
  onRetry?: (messageId: string) => void;
  onRollback?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  onResolveTransfer?: (
    messageId: string,
    resolution: "accepted" | "rejected",
  ) => void;
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
  const canEdit = Boolean(message.canEdit && onEdit);
  const hasActions = canRollback || canEdit || canShowTranscript;
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
            onRollback?.(message.sourceMessageId ?? message.id);
          }}
        >
          <ArrowCounterClockwise size={14} />
          回溯
        </button>
      ) : null}
      {canEdit ? (
        <button
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white active:scale-95"
          type="button"
          onClick={() => {
            setIsActionOpen(false);
            onEdit?.(
              message.sourceMessageId ?? message.id,
              message.sourceText ?? message.text,
            );
          }}
        >
          <PencilSimple size={14} />
          修改
        </button>
      ) : null}
    </div>
  ) : null;

  if (message.kind === "memory-summary")
    return (
      <div className="self-center text-[11px] text-white/32">
        已自动总结对话
      </div>
    );

  if (message.kind === "runtime-error")
    return (
      <div className="self-center text-center text-[11px] leading-5 text-red-300/75">
        运行失败：{message.text}
      </div>
    );

  if (message.kind === "image") {
    if (!message.mediaUrl) return null;
    return (
      <div
        className={`relative flex max-w-[85%] gap-2 md:max-w-[70%] ${
          mine ? "items-end self-end" : "items-start self-start"
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
          <div className="mt-1 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        )}
        <CachedMediaImage
          className={`max-h-[480px] max-w-[360px] rounded-xl object-cover ${
            mine && message.deliveryState === "failed"
              ? "outline outline-1 outline-red-300/25"
              : ""
          }`}
          mediaUrl={message.mediaUrl}
          alt={mine ? "我发送的图片" : "角色发送的图片"}
        />
        {mine ? (
          <div className="mt-1 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
        ) : null}
      </div>
    );
  }

  if (message.kind === "sticker") {
    if (!message.mediaUrl) return null;
    return (
      <div
        className={`relative flex max-w-[55%] items-end gap-2 ${mine ? "self-end" : "self-start"}`}
      >
        {!mine ? (
          <div className="mb-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        ) : null}
        <CachedMediaImage
          className="max-h-44 max-w-44 object-contain"
          mediaUrl={message.mediaUrl}
          alt={mine ? "我发送的表情" : "角色发送的表情"}
        />
        {mine ? (
          <div className="mb-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
        ) : null}
      </div>
    );
  }

  if (message.kind === "transfer") {
    const pending = message.transferStatus === "pending";
    const canResolve = !mine && pending && message.transferDirection === "paid";
    return (
      <div
        className={`relative flex w-[min(82%,320px)] items-end gap-2 ${mine ? "self-end" : "self-start"}`}
      >
        {!mine ? (
          <div className="mb-3 h-7 w-1 flex-shrink-0 rounded-full bg-amber-200/35" />
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-amber-200/10 bg-gradient-to-br from-[#7a4b16] to-[#4b2b10] shadow-[0_14px_32px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-white/14 text-white">
              <Money size={23} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-semibold tabular-nums text-white">
                ¥{formatTransferAmount(message.transferAmount)}
              </p>
              <p className="mt-0.5 truncate text-xs text-white/58">
                {message.transferNote || (mine ? "你发起的转账" : "向你转账")}
              </p>
            </div>
          </div>
          <div className="border-t border-white/10 bg-black/10 px-4 py-2.5 text-xs text-white/55">
            {pending
              ? "待接收"
              : message.transferStatus === "accepted"
                ? "已接收"
                : "已拒收"}
          </div>
          {canResolve ? (
            <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10">
              <button
                className="flex items-center justify-center gap-1.5 bg-[#4b2b10] py-2.5 text-xs text-white/65 hover:text-white"
                type="button"
                onClick={() => onResolveTransfer?.(message.id, "rejected")}
              >
                <X size={14} />
                拒收
              </button>
              <button
                className="flex items-center justify-center gap-1.5 bg-[#4b2b10] py-2.5 text-xs font-medium text-white hover:bg-[#573414]"
                type="button"
                onClick={() => onResolveTransfer?.(message.id, "accepted")}
              >
                <Check size={14} />
                收款
              </button>
            </div>
          ) : null}
        </div>
        {mine ? (
          <div className="mb-3 h-7 w-1 flex-shrink-0 rounded-full bg-amber-200/20" />
        ) : null}
      </div>
    );
  }

  if (message.kind === "voice") {
    return (
      <div
        className={`relative flex max-w-[85%] gap-2 md:max-w-[70%] ${
          mine ? "items-end self-end" : "items-start self-start"
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
          <div className="mt-3 h-7 w-1 flex-shrink-0 rounded-full bg-white/25" />
        )}
        <VoiceBubble
          mediaUrl={message.mediaUrl}
          durationSeconds={message.durationSeconds}
          transcript={isTranscriptOpen ? cleanTranscript : undefined}
          suppressNextClickRef={didLongPressRef}
        />
        {mine ? (
          <div className="mt-3 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
        ) : null}
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
        <ParentheticalText value={message.text} />
        {!mine && message.isPending ? (
          <SpinnerGap
            className="ml-2 inline animate-spin text-white/35"
            size={13}
            aria-label="回复生成中"
          />
        ) : null}
      </div>
      {mine ? (
        <div className="mb-2 h-7 w-1 flex-shrink-0 rounded-full bg-white/15" />
      ) : null}
    </div>
  );
}

function formatTransferAmount(amount?: number) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? amount.toFixed(2)
    : "0.00";
}

function ParentheticalText({ value }: { value: string }) {
  return tokenizeParentheticalText(value).map((run, index) => (
    <span key={index} className={run.muted ? "text-white/38" : undefined}>
      {run.text}
    </span>
  ));
}

function CachedMediaImage({
  mediaUrl,
  className,
  alt,
}: {
  mediaUrl: string;
  className: string;
  alt: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(
    () => !getCacheableMediaKey(mediaUrl),
  );
  const source = useCachedMediaObjectUrl(mediaUrl, shouldLoad);

  useEffect(() => {
    if (!getCacheableMediaKey(mediaUrl)) {
      setShouldLoad(true);
      return;
    }
    setShouldLoad(false);
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [mediaUrl]);

  return (
    <div
      ref={containerRef}
      className="min-h-24 min-w-32 rounded-xl bg-white/[0.025]"
    >
      {source ? (
        <img className={className} src={source} alt={alt} loading="lazy" />
      ) : null}
    </div>
  );
}

function VoiceBubble({
  mediaUrl,
  durationSeconds,
  transcript,
  suppressNextClickRef,
}: {
  mediaUrl?: string;
  durationSeconds?: number;
  transcript?: string;
  suppressNextClickRef: React.MutableRefObject<boolean>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const playWhenReadyRef = useRef(false);
  const source = useCachedMediaObjectUrl(mediaUrl, shouldLoad);

  useEffect(() => {
    setDuration(0);
    setIsPlaying(false);
    setShouldLoad(false);
    playWhenReadyRef.current = false;
  }, [mediaUrl]);

  useEffect(() => {
    if (!source || !playWhenReadyRef.current) return;
    playWhenReadyRef.current = false;
    void audioRef.current?.play().catch(() => undefined);
  }, [source]);

  const toggle = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      if (!mediaUrl) return;
      playWhenReadyRef.current = true;
      setShouldLoad(true);
      return;
    }
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const resolvedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? durationSeconds
      : Number.isFinite(duration)
        ? duration
        : 0;
  const seconds =
    resolvedDuration > 0 ? Math.max(1, Math.round(resolvedDuration)) : null;
  const width = Math.min(280, Math.max(148, 142 + (seconds ?? 0) * 3));

  return (
    <div className="min-w-0">
      <button
        className="flex h-12 items-center gap-3 rounded-xl bg-white/[0.055] px-4 text-left text-white transition hover:bg-white/[0.075] active:scale-[0.99]"
        style={{ width }}
        type="button"
        aria-label={
          mediaUrl ? (isPlaying ? "暂停语音" : "播放语音") : "语音生成中"
        }
        onClick={toggle}
        disabled={!mediaUrl}
      >
        <Waveform
          size={23}
          weight={isPlaying ? "fill" : "duotone"}
          className={isPlaying ? "animate-pulse text-white" : "text-white/75"}
        />
        {seconds || mediaUrl ? (
          <span className="ml-auto text-xs tabular-nums text-white/48">
            {seconds ? `${seconds}″` : "语音"}
          </span>
        ) : null}
      </button>
      {source ? (
        <audio
          ref={audioRef}
          className="hidden"
          preload="none"
          src={source}
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration;
            if (Number.isFinite(next)) setDuration(next);
          }}
          onDurationChange={(event) => {
            const next = event.currentTarget.duration;
            if (Number.isFinite(next)) setDuration(next);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      ) : null}
      {transcript ? (
        <p className="mt-2 max-w-[320px] rounded-xl bg-white/[0.035] px-3.5 py-2.5 text-sm leading-6 text-white/72">
          <ParentheticalText value={transcript} />
        </p>
      ) : null}
    </div>
  );
}

function useCachedMediaObjectUrl(
  mediaUrl: string | undefined,
  enabled: boolean,
) {
  const [source, setSource] = useState<string | undefined>(() =>
    mediaUrl && !getCacheableMediaKey(mediaUrl)
      ? resolveMediaUrl(mediaUrl)
      : undefined,
  );

  useEffect(() => {
    const resolved = resolveMediaUrl(mediaUrl);
    if (!resolved) {
      setSource(undefined);
      return;
    }
    if (!getCacheableMediaKey(resolved)) {
      setSource(resolved);
      return;
    }
    if (!enabled) {
      setSource(undefined);
      return;
    }

    let cancelled = false;
    let objectUrl: string | undefined;
    void mediaCache.get(resolved).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setSource(resolved);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, mediaUrl]);

  return source;
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
