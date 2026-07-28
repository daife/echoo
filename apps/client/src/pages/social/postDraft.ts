import type { SocialPostContent } from "@echoo/shared";

let draftSequence = 0;

export type DraftPostBlock =
  | { id: string; type: "text"; text: string }
  | {
      id: string;
      type: "image" | "audio";
      source: "existing";
      resourceId: string;
      previewUrl: string;
      durationSeconds?: number;
    }
  | {
      id: string;
      type: "image" | "audio";
      source: "file";
      file: File;
      previewUrl: string;
      durationSeconds?: number;
    };

export function newTextBlock(text = ""): DraftPostBlock {
  return { id: nextDraftId(), type: "text", text };
}

export function contentToDraft(content?: SocialPostContent[]): DraftPostBlock[] {
  if (!content?.length) return [newTextBlock()];
  return content.map((block) =>
    block.type === "text"
      ? newTextBlock(block.text)
      : {
          id: nextDraftId(),
          type: block.type,
          source: "existing" as const,
          resourceId: block.resourceId,
          previewUrl: block.resourcePath,
          ...(block.type === "audio"
            ? { durationSeconds: block.durationSeconds }
            : {}),
        },
  );
}

export function insertMediaBlock(
  blocks: DraftPostBlock[],
  selection: { blockId: string; start: number; end: number } | null,
  media: Extract<DraftPostBlock, { type: "image" | "audio" }>,
) {
  const index = selection
    ? blocks.findIndex(
        (block) => block.id === selection.blockId && block.type === "text",
      )
    : -1;
  if (index < 0) {
    const trailing = newTextBlock();
    return {
      blocks: [...blocks, media, trailing],
      focusBlockId: trailing.id,
    };
  }

  const textBlock = blocks[index]!;
  if (textBlock.type !== "text") return { blocks, focusBlockId: undefined };
  const start = Math.max(0, Math.min(textBlock.text.length, selection!.start));
  const end = Math.max(start, Math.min(textBlock.text.length, selection!.end));
  const trailing = newTextBlock(textBlock.text.slice(end));
  return {
    blocks: [
      ...blocks.slice(0, index),
      { ...textBlock, text: textBlock.text.slice(0, start) },
      media,
      trailing,
      ...blocks.slice(index + 1),
    ],
    focusBlockId: trailing.id,
  };
}

export function removeMediaBlock(blocks: DraftPostBlock[], blockId: string) {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0 || blocks[index]?.type === "text") return blocks;
  const previous = blocks[index - 1];
  const next = blocks[index + 1];
  if (previous?.type === "text" && next?.type === "text")
    return [
      ...blocks.slice(0, index - 1),
      { ...previous, text: previous.text + next.text },
      ...blocks.slice(index + 2),
    ];
  const remaining = blocks.filter((block) => block.id !== blockId);
  return remaining.length ? remaining : [newTextBlock()];
}

export function draftTextLength(blocks: DraftPostBlock[]) {
  return blocks.reduce(
    (total, block) => total + (block.type === "text" ? block.text.length : 0),
    0,
  );
}

export function hasDraftContent(blocks: DraftPostBlock[]) {
  return blocks.some(
    (block) => block.type !== "text" || Boolean(block.text.trim()),
  );
}

export function nextDraftId() {
  draftSequence += 1;
  return `post-draft-${draftSequence}`;
}
