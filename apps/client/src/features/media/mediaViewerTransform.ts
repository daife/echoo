export interface MediaViewerTransform {
  scale: number;
  x: number;
  y: number;
}

export interface MediaViewerSize {
  width: number;
  height: number;
}

export interface MediaViewerPoint {
  x: number;
  y: number;
}

export const MIN_MEDIA_SCALE = 1;
export const MAX_MEDIA_SCALE = 4;

export function clampMediaScale(scale: number) {
  return Math.min(MAX_MEDIA_SCALE, Math.max(MIN_MEDIA_SCALE, scale));
}

export function clampMediaTransform(
  transform: MediaViewerTransform,
  viewport: MediaViewerSize,
  content: MediaViewerSize,
): MediaViewerTransform {
  const scale = clampMediaScale(transform.scale);
  if (scale === MIN_MEDIA_SCALE) return { scale, x: 0, y: 0 };
  const maximumX = Math.max(0, (content.width * scale - viewport.width) / 2);
  const maximumY = Math.max(0, (content.height * scale - viewport.height) / 2);
  return {
    scale,
    x: Math.min(maximumX, Math.max(-maximumX, transform.x)),
    y: Math.min(maximumY, Math.max(-maximumY, transform.y)),
  };
}

export function zoomMediaTransform(
  current: MediaViewerTransform,
  requestedScale: number,
  focalPoint: MediaViewerPoint,
  viewport: MediaViewerSize,
  content: MediaViewerSize,
): MediaViewerTransform {
  const scale = clampMediaScale(requestedScale);
  if (scale === MIN_MEDIA_SCALE) return { scale, x: 0, y: 0 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const ratio = scale / current.scale;
  return clampMediaTransform(
    {
      scale,
      x:
        focalPoint.x - center.x - (focalPoint.x - center.x - current.x) * ratio,
      y:
        focalPoint.y - center.y - (focalPoint.y - center.y - current.y) * ratio,
    },
    viewport,
    content,
  );
}

export function distanceBetween(
  left: MediaViewerPoint,
  right: MediaViewerPoint,
) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function midpointBetween(
  left: MediaViewerPoint,
  right: MediaViewerPoint,
): MediaViewerPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}
