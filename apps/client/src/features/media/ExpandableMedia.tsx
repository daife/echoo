import type { MediaVariant } from "@echoo/shared";
import {
  ArrowCounterClockwise,
  ArrowsOut,
  Minus,
  Plus,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import { useMediaSource } from "./MediaAsset";
import {
  clampMediaTransform,
  distanceBetween,
  midpointBetween,
  zoomMediaTransform,
  type MediaViewerPoint,
  type MediaViewerTransform,
} from "./mediaViewerTransform";

export type ExpandableMediaKind = "image" | "sticker" | "video";

const RESET_TRANSFORM: MediaViewerTransform = { scale: 1, x: 0, y: 0 };

export function ExpandableMedia({
  mediaUrl,
  kind,
  alt,
  previewVariant = kind === "sticker" ? "thumb" : "display",
  triggerClassName,
  mediaClassName,
  fallbackClassName = "grid h-full min-h-16 min-w-24 place-items-center px-3 text-center text-xs text-white/35",
  fallbackLabel = kind === "sticker" ? "表情已删除" : "媒体不可用",
  failed = false,
  open,
  onOpen,
  onClose,
}: {
  mediaUrl: string;
  kind: ExpandableMediaKind;
  alt: string;
  previewVariant?: MediaVariant;
  triggerClassName: string;
  mediaClassName: string;
  fallbackClassName?: string;
  fallbackLabel?: string;
  failed?: boolean;
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [highResolutionRequested, setHighResolutionRequested] = useState(false);
  const isOpen = open ?? internalOpen;
  const effectivePreviewVariant =
    kind === "video" ? "original" : previewVariant;
  const preview = useMediaSource(mediaUrl, effectivePreviewVariant, true);
  const highResolution = useMediaSource(
    mediaUrl,
    "original",
    kind !== "video" && highResolutionRequested,
  );

  const openViewer = () => {
    onOpen?.();
    if (open === undefined) setInternalOpen(true);
  };
  const closeViewer = useCallback(() => {
    onClose?.();
    if (open === undefined) setInternalOpen(false);
  }, [onClose, open]);

  return (
    <>
      <button
        className={`${triggerClassName} ${failed ? "outline outline-1 outline-red-300/25" : ""}`}
        type="button"
        data-media-frame={kind}
        aria-label={`${alt}，点击${onOpen ? "查看动态" : "放大查看"}`}
        onClick={openViewer}
      >
        {preview.source ? (
          kind === "video" ? (
            <video
              className={mediaClassName}
              src={preview.source}
              preload="metadata"
              muted
              playsInline
              aria-hidden="true"
            />
          ) : (
            <img
              className={mediaClassName}
              src={preview.source}
              alt={alt}
              loading="lazy"
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onError={preview.fallbackToDirect}
            />
          )
        ) : preview.unavailable ? (
          <span className={fallbackClassName}>{fallbackLabel}</span>
        ) : (
          <span
            className="block h-full min-h-16 w-full min-w-24 animate-pulse bg-white/[0.035]"
            aria-label="媒体加载中"
          />
        )}
        <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <ArrowsOut size={15} weight="bold" />
        </span>
      </button>
      <MediaLightbox
        mediaKey={`${mediaUrl}:${kind}`}
        kind={kind}
        source={highResolution.source ?? preview.source}
        alt={alt}
        open={isOpen}
        onClose={closeViewer}
        onZoomDemand={() => setHighResolutionRequested(true)}
      />
    </>
  );
}

export function MediaLightbox({
  mediaKey,
  kind,
  source,
  alt,
  open,
  onClose,
  onZoomDemand,
}: {
  mediaKey: string;
  kind: ExpandableMediaKind;
  source?: string;
  alt: string;
  open: boolean;
  onClose: () => void;
  onZoomDemand?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const transformRef = useRef<MediaViewerTransform>(RESET_TRANSFORM);
  const [transform, setTransform] = useState(RESET_TRANSFORM);
  const pointersRef = useRef(new Map<number, MediaViewerPoint>());
  const gestureRef = useRef<
    | {
        type: "pan";
        point: MediaViewerPoint;
        transform: MediaViewerTransform;
        moved: boolean;
      }
    | {
        type: "pinch";
        distance: number;
        midpoint: MediaViewerPoint;
        transform: MediaViewerTransform;
      }
    | undefined
  >(undefined);
  const lastTapRef = useRef<
    { at: number; point: MediaViewerPoint } | undefined
  >(undefined);

  const updateTransform = useCallback((next: MediaViewerTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return null;
    const viewportRect = viewport.getBoundingClientRect();
    return {
      viewportRect,
      viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
      content: { width: image.clientWidth, height: image.clientHeight },
    };
  }, []);

  const zoomTo = useCallback(
    (scale: number, clientPoint?: MediaViewerPoint) => {
      const measured = measure();
      if (!measured) return;
      const point = clientPoint
        ? {
            x: clientPoint.x - measured.viewportRect.left,
            y: clientPoint.y - measured.viewportRect.top,
          }
        : {
            x: measured.viewport.width / 2,
            y: measured.viewport.height / 2,
          };
      const next = zoomMediaTransform(
        transformRef.current,
        scale,
        point,
        measured.viewport,
        measured.content,
      );
      if (next.scale > 1) onZoomDemand?.();
      updateTransform(next);
    },
    [measure, onZoomDemand, updateTransform],
  );

  useBackHandler(onClose, {
    enabled: open,
    priority: BACK_HANDLER_PRIORITY.fullscreen,
  });

  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = undefined;
    lastTapRef.current = undefined;
    updateTransform(RESET_TRANSFORM);
  }, [mediaKey, open, updateTransform]);

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

  useEffect(() => {
    if (!open || kind === "video") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheelEvent = (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(transformRef.current.scale * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    viewport.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheelEvent);
  }, [kind, open, zoomTo]);

  useEffect(() => {
    if (!open || kind === "video") return;
    const clampAfterResize = () => {
      const measured = measure();
      if (!measured) return;
      updateTransform(
        clampMediaTransform(
          transformRef.current,
          measured.viewport,
          measured.content,
        ),
      );
    };
    window.addEventListener("resize", clampAfterResize);
    return () => window.removeEventListener("resize", clampAfterResize);
  }, [kind, measure, open, updateTransform]);

  if (!open || typeof document === "undefined") return null;

  const pointFromPointer = (event: ReactPointerEvent) => ({
    x: event.clientX,
    y: event.clientY,
  });

  const beginGesture = () => {
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      gestureRef.current = {
        type: "pinch",
        distance: Math.max(1, distanceBetween(points[0]!, points[1]!)),
        midpoint: midpointBetween(points[0]!, points[1]!),
        transform: transformRef.current,
      };
    } else if (points[0]) {
      gestureRef.current = {
        type: "pan",
        point: points[0],
        transform: transformRef.current,
        moved: false,
      };
    } else {
      gestureRef.current = undefined;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, pointFromPointer(event));
    beginGesture();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, pointFromPointer(event));
    const measured = measure();
    const gesture = gestureRef.current;
    if (!measured || !gesture) return;
    const points = [...pointersRef.current.values()];
    if (gesture.type === "pinch" && points.length >= 2) {
      const midpoint = midpointBetween(points[0]!, points[1]!);
      const scale =
        gesture.transform.scale *
        (distanceBetween(points[0]!, points[1]!) / gesture.distance);
      const localStart = {
        x: gesture.midpoint.x - measured.viewportRect.left,
        y: gesture.midpoint.y - measured.viewportRect.top,
      };
      const zoomed = zoomMediaTransform(
        gesture.transform,
        scale,
        localStart,
        measured.viewport,
        measured.content,
      );
      const next = clampMediaTransform(
        {
          ...zoomed,
          x: zoomed.x + midpoint.x - gesture.midpoint.x,
          y: zoomed.y + midpoint.y - gesture.midpoint.y,
        },
        measured.viewport,
        measured.content,
      );
      if (next.scale > 1) onZoomDemand?.();
      updateTransform(next);
      return;
    }
    if (gesture.type === "pan" && points[0] && gesture.transform.scale > 1) {
      const deltaX = points[0].x - gesture.point.x;
      const deltaY = points[0].y - gesture.point.y;
      if (Math.hypot(deltaX, deltaY) > 3) gesture.moved = true;
      updateTransform(
        clampMediaTransform(
          {
            ...gesture.transform,
            x: gesture.transform.x + deltaX,
            y: gesture.transform.y + deltaY,
          },
          measured.viewport,
          measured.content,
        ),
      );
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const point = pointFromPointer(event);
    pointersRef.current.delete(event.pointerId);
    if (
      event.type === "pointerup" &&
      event.pointerType === "touch" &&
      gesture?.type === "pan" &&
      !gesture.moved
    ) {
      const previous = lastTapRef.current;
      const now = Date.now();
      if (
        previous &&
        now - previous.at < 320 &&
        distanceBetween(previous.point, point) < 32
      ) {
        zoomTo(transformRef.current.scale > 1 ? 1 : 2, point);
        lastTapRef.current = undefined;
      } else {
        lastTapRef.current = { at: now, point };
      }
    }
    beginGesture();
  };

  return createPortal(
    <div
      className="app-overlay app-media-viewer fixed inset-0 grid touch-none select-none place-items-center overflow-hidden bg-black/88 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}放大预览`}
      data-media-lightbox={kind}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-20 grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-black/45 text-white/80 transition hover:bg-black/65 hover:text-white active:scale-95"
        type="button"
        aria-label="关闭媒体预览"
        autoFocus
        onClick={onClose}
      >
        <X size={21} weight="bold" />
      </button>
      {kind !== "video" ? (
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1.5 backdrop-blur-md">
          <ZoomButton
            label="缩小图片"
            onClick={() => zoomTo(transform.scale / 1.35)}
          >
            <Minus size={17} />
          </ZoomButton>
          <button
            className="min-w-14 rounded-lg px-2 py-2 text-xs tabular-nums text-white/70 hover:bg-white/10 hover:text-white"
            type="button"
            aria-label="复位图片"
            onClick={() => updateTransform(RESET_TRANSFORM)}
          >
            {Math.round(transform.scale * 100)}%
          </button>
          <ZoomButton
            label="放大图片"
            onClick={() => zoomTo(transform.scale * 1.35)}
          >
            <Plus size={17} />
          </ZoomButton>
          <ZoomButton
            label="复位图片"
            onClick={() => updateTransform(RESET_TRANSFORM)}
          >
            <ArrowCounterClockwise size={17} />
          </ZoomButton>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className={`flex h-full w-full items-center justify-center overflow-hidden ${kind === "video" ? "touch-auto select-auto" : "touch-none select-none"}`}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) onClose();
        }}
        onPointerDown={kind === "video" ? undefined : handlePointerDown}
        onPointerMove={kind === "video" ? undefined : handlePointerMove}
        onPointerUp={kind === "video" ? undefined : handlePointerEnd}
        onPointerCancel={kind === "video" ? undefined : handlePointerEnd}
        onDoubleClick={
          kind === "video"
            ? undefined
            : (event) => {
                event.preventDefault();
                zoomTo(transformRef.current.scale > 1 ? 1 : 2, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }
        }
        onContextMenu={
          kind === "video" ? undefined : (event) => event.preventDefault()
        }
      >
        {source ? (
          kind === "video" ? (
            <video
              className="max-h-full max-w-full rounded-xl bg-black object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              src={source}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <img
              ref={imageRef}
              className="max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)] will-change-transform"
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                touchAction: "none",
                userSelect: "none",
              }}
              src={source}
              alt={alt}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onLoad={() => {
                const measured = measure();
                if (!measured) return;
                updateTransform(
                  clampMediaTransform(
                    transformRef.current,
                    measured.viewport,
                    measured.content,
                  ),
                );
              }}
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

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white active:scale-95"
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
