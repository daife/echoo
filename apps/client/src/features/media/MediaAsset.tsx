import type { MediaVariant } from "@echoo/shared";
import { useEffect, useRef, useState } from "react";
import {
  getResourceId,
  mediaCache,
  resolveMediaUrl,
} from "../../services/mediaCache";

export function MediaAsset({
  mediaUrl,
  variant = "thumb",
  className,
  alt,
  eager = false,
}: {
  mediaUrl?: string;
  variant?: MediaVariant;
  className: string;
  alt: string;
  eager?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(
    eager || !getResourceId(mediaUrl),
  );
  const source = useMediaObjectUrl(mediaUrl, variant, shouldLoad);

  useEffect(() => {
    if (eager || !getResourceId(mediaUrl)) {
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
  }, [eager, mediaUrl]);

  return (
    <div ref={containerRef} className="h-full w-full bg-white/[0.025]">
      {source ? (
        <img
          className={className}
          src={source}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
        />
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
  const [source, setSource] = useState<string | undefined>(() =>
    mediaUrl && !getResourceId(mediaUrl)
      ? resolveMediaUrl(mediaUrl)
      : undefined,
  );
  useEffect(() => {
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
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void mediaCache.get(mediaUrl, variant, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      if (!blob) {
        void mediaCache.getDirectUrl(mediaUrl, variant).then((url) => {
          if (!controller.signal.aborted) setSource(resolveMediaUrl(url));
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
  }, [enabled, mediaUrl, variant]);
  return source;
}
