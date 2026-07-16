import type { MediaReference, MediaVariant } from "@echoo/shared";

export function createVisualMediaReference(input: {
  resourceId: string;
  kind: "image" | "sticker" | "video";
  variants: MediaVariant[];
}): MediaReference {
  return {
    resourceId: input.resourceId,
    kind: input.kind,
    variants: input.variants,
  };
}
