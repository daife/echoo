import type { MouseEvent, ReactNode } from "react";
import { isInternalPublicLink } from "../../app/publicLinks";

export interface LinkedTextProps {
  text: string;
  onOpenPost?: (postId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  className?: string;
}

export function LinkedText({
  text,
  onOpenPost,
  onOpenAsset,
  className,
}: LinkedTextProps) {
  const nodes: ReactNode[] = [];
  for (const [index, token] of tokenizeLinkedText(text).entries()) {
    if (token.type === "text") {
      nodes.push(token.value);
      continue;
    }
    nodes.push(
      <a
        key={`${index}:${token.value}`}
        href={token.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#c7b9ed] underline decoration-[#c7b9ed]/35 underline-offset-2 hover:text-white"
        onClick={(event) =>
          openLinkedTarget(event, token.value, onOpenPost, onOpenAsset)
        }
      >
        {token.value}
      </a>,
    );
  }
  return <span className={className}>{nodes}</span>;
}

export type LinkedTextToken =
  { type: "text"; value: string } | { type: "url"; value: string };

export function tokenizeLinkedText(text: string): LinkedTextToken[] {
  const tokens: LinkedTextToken[] = [];
  const expression = /https?:\/\/[^\s<>"']+/giu;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    if (start > offset) appendText(tokens, text.slice(offset, start));
    const raw = match[0];
    const value = trimTrailingPunctuation(raw);
    if (value) tokens.push({ type: "url", value });
    if (value.length < raw.length) appendText(tokens, raw.slice(value.length));
    offset = start + raw.length;
  }
  if (offset < text.length) appendText(tokens, text.slice(offset));
  return tokens.length ? tokens : [{ type: "text", value: text }];
}

function appendText(tokens: LinkedTextToken[], value: string) {
  if (!value) return;
  const previous = tokens.at(-1);
  if (previous?.type === "text") previous.value += value;
  else tokens.push({ type: "text", value });
}

function trimTrailingPunctuation(value: string) {
  return value.replace(/[.,!?;:，。！？；：、)\]}）】》」』]+$/u, "");
}

function openLinkedTarget(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  onOpenPost?: (postId: string) => void,
  onOpenAsset?: (assetId: string) => void,
) {
  event.stopPropagation();
  const target = isInternalPublicLink(new URL(href));
  if (!target) return;
  const handler = target.type === "post" ? onOpenPost : onOpenAsset;
  if (!handler) return;
  event.preventDefault();
  handler(target.id);
}
