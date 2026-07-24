import {
  ArrowsOut,
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
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BACK_HANDLER_PRIORITY } from "../../../app/backNavigation";
import { useBackHandler } from "../../../app/providers/BackNavigationProvider";
import { MediaAsset, useMediaDirectUrl } from "../../media/MediaAsset";
import {
  sanitizeVoiceTranscript,
  tokenizeParentheticalText,
} from "../messagePresentation";
import { IdentityAvatar } from "../../../shared/components/IdentityAvatar";

export interface MessageBubbleModel {
  id: string;
  from: string;
  text: string;
  createdAt: number;
  deliveryState?: "sending" | "failed";
  kind?:
    | "text"
    | "image"
    | "video"
    | "voice"
    | "sticker"
    | "transfer"
    | "memory-summary";
  mediaUrl?: string;
  transcript?: string;
  durationSeconds?: number;
  isAudioStreaming?: boolean;
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
  avatarUrl,
  avatarAlt,
  onRetry,
  onRollback,
  onEdit,
  onResolveTransfer,
  playingVoiceMessageId,
  isVoicePlaying = false,
  blockedVoiceMessageId,
  onToggleVoice,
}: {
  message: MessageBubbleModel;
  avatarUrl?: string;
  avatarAlt?: string;
  onRetry?: (messageId: string) => void;
  onRollback?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  onResolveTransfer?: (
    messageId: string,
    resolution: "accepted" | "rejected",
  ) => void;
  playingVoiceMessageId?: string;
  isVoicePlaying?: boolean;
  blockedVoiceMessageId?: string;
  onToggleVoice?: (messageId: string, mediaUrl?: string) => void;
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
  const [isMediaOpen, setIsMediaOpen] = useState(false);
  useBackHandler(() => setIsActionOpen(false), {
    enabled: isActionOpen,
    priority: BACK_HANDLER_PRIORITY.popover,
  });
  useBackHandler(() => setIsMediaOpen(false), {
    enabled: isMediaOpen,
    priority: BACK_HANDLER_PRIORITY.fullscreen,
  });
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

  const openMedia = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    setIsMediaOpen(true);
  };

  const mediaViewer =
    message.mediaUrl &&
    (message.kind === "image" ||
      message.kind === "sticker" ||
      message.kind === "video") ? (
      <MediaViewer
        mediaUrl={message.mediaUrl}
        kind={message.kind}
        open={isMediaOpen}
        alt={
          message.kind === "sticker"
            ? mine
              ? "我发送的表情"
              : "角色发送的表情"
            : message.kind === "video"
              ? mine
                ? "我发送的视频"
                : "角色发送的视频"
              : mine
                ? "我发送的图片"
                : "角色发送的图片"
        }
        onClose={() => setIsMediaOpen(false)}
      />
    ) : null;

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

  if (message.kind === "image" || message.kind === "video") {
    if (!message.mediaUrl) return null;
    return (
      <>
        <MessageRow
          mine={mine}
          avatarUrl={avatarUrl}
          avatarAlt={avatarAlt}
          deliveryState={message.deliveryState}
          canRetry={Boolean(canRetry)}
          onRetry={() => onRetry?.(message.id)}
          actionMenu={actionMenu}
          interactionProps={longPressProps}
        >
          <ChatVisualMedia
            mediaUrl={message.mediaUrl}
            alt={
              message.kind === "video"
                ? mine
                  ? "我发送的视频"
                  : "角色发送的视频"
                : mine
                  ? "我发送的图片"
                  : "角色发送的图片"
            }
            kind={message.kind}
            failed={mine && message.deliveryState === "failed"}
            onOpen={openMedia}
          />
        </MessageRow>
        {mediaViewer}
      </>
    );
  }

  if (message.kind === "sticker") {
    if (!message.mediaUrl) return null;
    return (
      <>
        <MessageRow mine={mine} avatarUrl={avatarUrl} avatarAlt={avatarAlt}>
          <ChatVisualMedia
            mediaUrl={message.mediaUrl}
            alt={mine ? "我发送的表情" : "角色发送的表情"}
            kind="sticker"
            onOpen={openMedia}
          />
        </MessageRow>
        {mediaViewer}
      </>
    );
  }

  if (message.kind === "transfer") {
    const pending = message.transferStatus === "pending";
    const canResolve = !mine && pending && message.transferDirection === "paid";
    return (
      <MessageRow mine={mine} avatarUrl={avatarUrl} avatarAlt={avatarAlt}>
        <div className="w-[min(82%,320px)] min-w-0 overflow-hidden rounded-2xl border border-amber-200/10 bg-gradient-to-br from-[#7a4b16] to-[#4b2b10] shadow-[0_14px_32px_rgba(0,0,0,0.22)]">
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
      </MessageRow>
    );
  }

  if (message.kind === "voice") {
    return (
      <MessageRow
        mine={mine}
        avatarUrl={avatarUrl}
        avatarAlt={avatarAlt}
        deliveryState={message.deliveryState}
        canRetry={Boolean(canRetry)}
        onRetry={() => onRetry?.(message.id)}
        actionMenu={actionMenu}
        interactionProps={longPressProps}
      >
        <VoiceBubble
          mediaUrl={message.mediaUrl}
          durationSeconds={message.durationSeconds}
          isStreaming={message.isAudioStreaming === true}
          isPlaying={playingVoiceMessageId === message.id && isVoicePlaying}
          isBlocked={blockedVoiceMessageId === message.id}
          transcript={isTranscriptOpen ? cleanTranscript : undefined}
          suppressNextClickRef={didLongPressRef}
          onToggle={() => onToggleVoice?.(message.id, message.mediaUrl)}
        />
      </MessageRow>
    );
  }

  return (
    <MessageRow
      mine={mine}
      avatarUrl={avatarUrl}
      avatarAlt={avatarAlt}
      deliveryState={message.deliveryState}
      canRetry={Boolean(canRetry)}
      onRetry={() => onRetry?.(message.id)}
      actionMenu={actionMenu}
      interactionProps={longPressProps}
    >
      <div
        className={`min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-sm leading-6 md:max-w-[70%] ${
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
    </MessageRow>
  );
}

function MessageRow({
  mine,
  avatarUrl,
  avatarAlt,
  deliveryState,
  canRetry = false,
  onRetry = () => undefined,
  actionMenu,
  interactionProps,
  children,
}: {
  mine: boolean;
  avatarUrl?: string;
  avatarAlt?: string;
  deliveryState?: "sending" | "failed";
  canRetry?: boolean;
  onRetry?: () => void;
  actionMenu?: ReactNode;
  interactionProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className="relative flex w-full min-w-0 items-start gap-2"
      data-message-row="contained"
      {...interactionProps}
    >
      {actionMenu}
      {!mine ? <MessageAvatar mediaUrl={avatarUrl} alt={avatarAlt} /> : null}
      <div
        className={`flex min-w-0 flex-1 items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}
      >
        {mine ? (
          <DeliveryIndicator
            state={deliveryState}
            canRetry={canRetry}
            onRetry={onRetry}
          />
        ) : null}
        {children}
      </div>
      {mine ? <MessageAvatar mediaUrl={avatarUrl} alt={avatarAlt} /> : null}
    </div>
  );
}

function MessageAvatar({ mediaUrl, alt }: { mediaUrl?: string; alt?: string }) {
  return (
    <IdentityAvatar
      mediaUrl={mediaUrl}
      alt={alt ?? "消息发送者头像"}
      className="mb-1 h-8 w-8 shrink-0"
    />
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

function ChatVisualMedia({
  mediaUrl,
  alt,
  kind,
  failed = false,
  onOpen,
}: {
  mediaUrl: string;
  alt: string;
  kind: "image" | "sticker" | "video";
  failed?: boolean;
  onOpen: () => void;
}) {
  const isSticker = kind === "sticker";
  const frameClass = isSticker
    ? "h-44 max-w-[min(240px,55vw)]"
    : "h-80 max-w-[min(360px,85vw)]";

  return (
    <button
      className={`group relative block w-fit min-w-0 max-w-full shrink overflow-hidden rounded-xl bg-white/[0.025] text-left transition active:scale-[0.99] ${frameClass} ${
        failed ? "outline outline-1 outline-red-300/25" : ""
      }`}
      type="button"
      data-media-frame={kind}
      aria-label={`${alt}，点击放大查看`}
      onClick={onOpen}
    >
      {kind === "video" ? (
        <InlineVideoPreview mediaUrl={mediaUrl} />
      ) : (
        <MediaAsset
          mediaUrl={mediaUrl}
          variant={isSticker ? "thumb" : "display"}
          containerClassName="h-full w-fit max-w-full"
          className="h-full w-auto max-w-full object-cover"
          alt={alt}
          fallbackLabel={kind === "sticker" ? "表情已删除" : "媒体不可用"}
        />
      )}
      <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <ArrowsOut size={15} weight="bold" />
      </span>
    </button>
  );
}

function InlineVideoPreview({ mediaUrl }: { mediaUrl: string }) {
  const source = useMediaDirectUrl(mediaUrl, true, "original");
  return source ? (
    <video
      className="h-full w-auto max-w-full bg-black/30 object-cover"
      src={source}
      preload="metadata"
      muted
      playsInline
      aria-hidden="true"
    />
  ) : (
    <div className="h-full w-60 animate-pulse bg-white/[0.035]" />
  );
}

function MediaViewer({
  mediaUrl,
  kind,
  alt,
  open,
  onClose,
}: {
  mediaUrl: string;
  kind: "image" | "sticker" | "video";
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const source = useMediaDirectUrl(mediaUrl, open, "original");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="app-overlay fixed inset-0 grid place-items-center bg-black/88 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}放大预览`}
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-black/45 text-white/80 transition hover:bg-black/65 hover:text-white active:scale-95"
        type="button"
        aria-label="关闭媒体预览"
        autoFocus
        onClick={onClose}
      >
        <X size={21} weight="bold" />
      </button>
      <div
        className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        {source ? (
          kind === "video" ? (
            <video
              className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] rounded-xl bg-black object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              src={source}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <img
              className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              src={source}
              alt={alt}
            />
          )
        ) : (
          <SpinnerGap
            className="animate-spin text-white/55"
            size={28}
            aria-label="媒体加载中"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function VoiceBubble({
  mediaUrl,
  durationSeconds,
  isStreaming,
  isPlaying,
  isBlocked,
  transcript,
  suppressNextClickRef,
  onToggle,
}: {
  mediaUrl?: string;
  durationSeconds?: number;
  isStreaming: boolean;
  isPlaying: boolean;
  isBlocked: boolean;
  transcript?: string;
  suppressNextClickRef: React.MutableRefObject<boolean>;
  onToggle: () => void;
}) {
  const toggle = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onToggle();
  };

  const resolvedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? durationSeconds
      : 0;
  const seconds =
    resolvedDuration > 0 ? Math.max(1, Math.round(resolvedDuration)) : null;
  const width = Math.min(280, Math.max(148, 142 + (seconds ?? 0) * 3));

  return (
    <div className="min-w-0 max-w-full">
      <button
        className="flex h-12 items-center gap-3 rounded-xl bg-white/[0.055] px-4 text-left text-white transition hover:bg-white/[0.075] active:scale-[0.99]"
        style={{ width, maxWidth: "100%" }}
        type="button"
        aria-label={
          isBlocked
            ? "自动播放受限，点击播放语音"
            : mediaUrl || isStreaming
              ? isPlaying
                ? "暂停语音"
                : "播放语音"
              : "语音生成中"
        }
        onClick={toggle}
        disabled={!mediaUrl && !isStreaming}
      >
        <Waveform
          size={23}
          weight={isPlaying ? "fill" : "duotone"}
          className={isPlaying ? "animate-pulse text-white" : "text-white/75"}
        />
        {seconds || mediaUrl || isStreaming ? (
          <span className="ml-auto text-xs tabular-nums text-white/48">
            {isBlocked ? "点击播放" : seconds ? `${seconds}″` : "语音"}
          </span>
        ) : null}
      </button>
      {transcript ? (
        <p className="mt-2 max-w-[320px] rounded-xl bg-white/[0.035] px-3.5 py-2.5 text-sm leading-6 text-white/72">
          <ParentheticalText value={transcript} />
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
        className="mb-1 grid h-7 w-7 shrink-0 place-items-center text-white/38"
        aria-label="发送中"
      >
        <SpinnerGap className="animate-spin" size={16} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <button
        className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-red-300/80 transition hover:bg-red-400/10 hover:text-red-200 disabled:cursor-default"
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
