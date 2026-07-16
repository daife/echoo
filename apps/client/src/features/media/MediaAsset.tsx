import type { MediaVariant } from "@echoo/shared";
import { useEffect, useState } from "react";
import {
  getResourceId,
  mediaCache,
  resolveMediaUrl,
} from "../../services/mediaCache";

export function MediaAsset({
  mediaUrl,
  variant = "thumb",
  className,
  containerClassName = "h-full w-full bg-white/[0.025]",
  alt,
  eager = false,
  fallbackLabel = "媒体不可用",
}: {
  mediaUrl?: string;
  variant?: MediaVariant;
  className: string;
  containerClassName?: string;
  alt: string;
  eager?: boolean;
  fallbackLabel?: string;
}) {
  const { source, unavailable, fallbackToDirect } = useMediaObjectUrl(
    mediaUrl,
    variant,
    true,
  );

  return (
    <div className={containerClassName}>
      {source ? (
        <img
          className={className}
          src={source}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          onError={fallbackToDirect}
        />
      ) : unavailable ? (
        <div className="grid h-full min-h-16 min-w-24 place-items-center px-3 text-center text-xs text-white/35">
          {fallbackLabel}
        </div>
      ) : null}
    </div>
  );
}

export function useMediaDirectUrl(
  mediaUrl: string | undefined,
  enabled: boolean,
  variant: MediaVariant = "original",
) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    if (!mediaUrl || !enabled) {
      setSource(undefined);
      return;
    }
    if (!getResourceId(mediaUrl)) {
      setSource(resolveMediaUrl(mediaUrl));
      return;
    }
    setSource(undefined);
    let cancelled = false;
    void mediaCache.getDirectUrl(mediaUrl, variant).then((url) => {
      if (!cancelled) setSource(resolveMediaUrl(url));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, mediaUrl, variant]);
  return source;
}

function useMediaObjectUrl(
  mediaUrl: string | undefined,
  variant: MediaVariant,
  enabled: boolean,
) {
  const fallbackKey = mediaUrl ? `${mediaUrl}:${variant}` : undefined;
  const [directFallbackKey, setDirectFallbackKey] = useState<string>();
  const preferDirect = Boolean(
    fallbackKey && directFallbackKey === fallbackKey,
  );
  const [source, setSource] = useState<string | undefined>(() =>
    mediaUrl && !getResourceId(mediaUrl)
      ? resolveMediaUrl(mediaUrl)
      : undefined,
  );
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setUnavailable(false);
    if (!mediaUrl) {
      setSource(undefined);
      return;
    }
    if (!getResourceId(mediaUrl)) {
      setSource(resolveMediaUrl(mediaUrl));
      return;
    }
    if (!enabled) {
      setSource(undefined);
      return;
    }
    if (preferDirect) {
      let cancelled = false;
      void mediaCache.getDirectUrl(mediaUrl, variant).then((url) => {
        if (!cancelled) {
          setSource(resolveMediaUrl(url));
          if (!url) setUnavailable(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void mediaCache.get(mediaUrl, variant, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      if (!blob) {
        void mediaCache.getDirectUrl(mediaUrl, variant).then((url) => {
          if (!controller.signal.aborted) {
            setSource(resolveMediaUrl(url));
            if (!url) setUnavailable(true);
          }
        });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, mediaUrl, preferDirect, variant]);
  return {
    source,
    unavailable,
    fallbackToDirect: () => {
      if (!fallbackKey || !getResourceId(mediaUrl)) return;
      if (preferDirect) setUnavailable(true);
      else setDirectFallbackKey(fallbackKey);
    },
  };
}
