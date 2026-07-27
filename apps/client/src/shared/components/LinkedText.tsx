import {
  createElement,
  type MouseEvent,
  type ReactNode,
} from "react";
import { isInternalPublicLink } from "../../app/publicLinks";

export interface MarkdownTextProps {
  text: string;
  onOpenPost?: (postId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  className?: string;
  variant?: "full" | "compact";
}

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string };

export type LinkedTextToken =
  | { type: "text"; value: string }
  | { type: "url"; value: string; label?: string };

const linkClassName =
  "text-[#c7b9ed] underline decoration-[#c7b9ed]/35 underline-offset-2 hover:text-white";

const fullHeadingClasses = [
  "text-2xl leading-tight",
  "text-xl leading-tight",
  "text-lg leading-snug",
  "text-base leading-snug",
  "text-sm leading-normal",
  "text-xs leading-normal",
] as const;

const compactHeadingClasses = [
  "text-base leading-snug",
  "text-[15px] leading-snug",
  "text-sm leading-normal",
  "text-[13px] leading-normal",
  "text-xs leading-normal",
  "text-[11px] leading-normal",
] as const;

export function MarkdownText({
  text,
  onOpenPost,
  onOpenAsset,
  className,
  variant = "full",
}: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const tag = `h${block.level}` as keyof HTMLElementTagNameMap;
          const size =
            (variant === "compact"
              ? compactHeadingClasses
              : fullHeadingClasses)[block.level - 1] ??
            (variant === "compact" ? "text-xs" : "text-sm");
          return createElement(
            tag,
            {
              key: `${index}:${block.level}`,
              className: `${index ? "mt-2" : ""} font-semibold text-white ${size}`,
            },
            renderInline(block.text, onOpenPost, onOpenAsset),
          );
        }
        if (!block.text)
          return <div key={index} aria-hidden="true" className="h-3" />;
        return (
          <div key={index} className={index ? "mt-1" : undefined}>
            {renderInline(block.text, onOpenPost, onOpenAsset)}
          </div>
        );
      })}
    </div>
  );
}

/** Kept as a compatibility alias for call sites outside the social surfaces. */
export const LinkedText = MarkdownText;

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  return text.replace(/\r\n?/gu, "\n").split("\n").map((line) => {
    const heading = /^(#{1,6})[\t ]+(.+)$/u.exec(line);
    return heading
      ? { type: "heading", level: heading[1].length, text: heading[2] }
      : { type: "paragraph", text: line };
  });
}

export function tokenizeLinkedText(text: string): LinkedTextToken[] {
  const tokens: LinkedTextToken[] = [];
  const expression =
    /\[([^\]\n]+)\]\((https?:\/\/[^\s<>"']+?)\)|(https?:\/\/[^\s<>"']+)/giu;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    if (start > offset) appendText(tokens, text.slice(offset, start));
    const namedHref = match[2];
    const raw = namedHref ?? match[3];
    const value = namedHref ? raw : trimTrailingPunctuation(raw);
    if (isSafeHttpUrl(value))
      tokens.push({
        type: "url",
        value,
        ...(namedHref ? { label: match[1] } : {}),
      });
    else appendText(tokens, match[0]);
    if (!namedHref && value.length < raw.length)
      appendText(tokens, raw.slice(value.length));
    offset = start + match[0].length;
  }
  if (offset < text.length) appendText(tokens, text.slice(offset));
  return tokens.length ? tokens : [{ type: "text", value: text }];
}

function renderInline(
  text: string,
  onOpenPost?: (postId: string) => void,
  onOpenAsset?: (assetId: string) => void,
) {
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
        className={linkClassName}
        onClick={(event) =>
          openLinkedTarget(event, token.value, onOpenPost, onOpenAsset)
        }
      >
        {token.label ?? token.value}
      </a>,
    );
  }
  return nodes;
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

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
