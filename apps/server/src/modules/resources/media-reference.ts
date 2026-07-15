import type { MediaReference, MediaVariant } from "@echoo/shared";

export function requireVisualDimensions(resource: {
  width?: number;
  height?: number;
}) {
  if (
    !Number.isInteger(resource.width) ||
    !Number.isInteger(resource.height) ||
    resource.width! <= 0 ||
    resource.height! <= 0
  )
    throw new Error("图片资源缺少有效尺寸。");
  return { width: resource.width!, height: resource.height! };
}

export function createVisualMediaReference(input: {
  resourceId: string;
  kind: "image" | "sticker" | "video";
  variants: MediaVariant[];
  width?: number;
  height?: number;
}): MediaReference {
  return {
    resourceId: input.resourceId,
    kind: input.kind,
    variants: input.variants,
    ...requireVisualDimensions(input),
  };
}
