import { Waveform } from "@phosphor-icons/react";
import type { SocialPostContent as SocialPostContentBlock } from "@echoo/shared";
import { useState } from "react";
import { ExpandableMedia } from "../../features/media/ExpandableMedia";
import { MarkdownText } from "../../shared/components/LinkedText";

export function PostContent({
  content,
  authorName,
  onOpenPost,
  onOpenAsset,
  variant = "full",
}: {
  content: SocialPostContentBlock[];
  authorName: string;
  onOpenPost?: (postId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  variant?: "full" | "compact";
}) {
  const groups = groupContent(content);
  return (
    <div className={variant === "compact" ? "space-y-3" : "space-y-4"}>
      {groups.map((group, index) =>
        group.type === "images" ? (
          <div
            key={`images:${group.items[0]?.resourceId}`}
            className={`grid gap-2 ${group.items.length === 1 ? "grid-cols-1" : group.items.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
          >
            {group.items.map((image, imageIndex) => (
              <ExpandableMedia
                key={image.resourceId}
                mediaUrl={image.resourcePath}
                kind="image"
                previewVariant="display"
                alt={`${authorName} 的动态图片 ${imageIndex + 1}`}
                triggerClassName="group relative block aspect-square w-full overflow-hidden rounded-xl bg-black/20"
                mediaClassName="h-full w-full object-cover"
              />
            ))}
          </div>
        ) : group.block.type === "text" ? (
          <MarkdownText
            key={`text:${index}`}
            text={group.block.text}
            onOpenPost={onOpenPost}
            onOpenAsset={onOpenAsset}
            variant={variant}
          />
        ) : (
          <PostAudio key={group.block.resourceId} block={group.block} />
        ),
      )}
    </div>
  );
}

export function postPlainText(content: SocialPostContentBlock[]) {
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

function PostAudio({
  block,
}: {
  block: Extract<SocialPostContentBlock, { type: "audio" }>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="rounded-xl border border-white/8 bg-white/[0.035] p-3"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-white/48">
        <Waveform size={17} className="text-[#c7b9ed]" />
        <span>语音</span>
        {block.durationSeconds > 0 ? (
          <span className="ml-auto tabular-nums">
            {formatDuration(block.durationSeconds)}
          </span>
        ) : null}
      </div>
      {failed ? (
        <p className="py-2 text-xs text-red-200/75">语音加载失败。</p>
      ) : (
        <audio
          className="h-10 w-full"
          controls
          preload="metadata"
          src={block.resourcePath}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function groupContent(content: SocialPostContentBlock[]) {
  const groups: Array<
    | { type: "block"; block: Exclude<SocialPostContentBlock, { type: "image" }> }
    | {
        type: "images";
        items: Array<Extract<SocialPostContentBlock, { type: "image" }>>;
      }
  > = [];
  for (const block of content) {
    if (block.type !== "image") {
      groups.push({ type: "block", block });
      continue;
    }
    const previous = groups.at(-1);
    if (previous?.type === "images") previous.items.push(block);
    else groups.push({ type: "images", items: [block] });
  }
  return groups;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
