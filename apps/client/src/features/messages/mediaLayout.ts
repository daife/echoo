export interface MediaDimensions {
  width: number;
  height: number;
}

const IMAGE_FALLBACK: MediaDimensions = { width: 320, height: 240 };
const STICKER_FALLBACK: MediaDimensions = { width: 176, height: 176 };

export function fitMessageMedia(
  dimensions: Partial<MediaDimensions> | undefined,
  kind: "image" | "sticker",
): MediaDimensions {
  const fallback = kind === "sticker" ? STICKER_FALLBACK : IMAGE_FALLBACK;
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (!isPositiveDimension(width) || !isPositiveDimension(height))
    return fallback;

  const maximumWidth = kind === "sticker" ? 176 : 360;
  const maximumHeight = kind === "sticker" ? 176 : 480;
  const scale = Math.min(1, maximumWidth / width, maximumHeight / height);
  return {
    width: Math.max(1, width * scale),
    height: Math.max(1, height * scale),
  };
}

function isPositiveDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
