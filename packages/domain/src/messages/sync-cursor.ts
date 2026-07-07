import type { Message } from "@echoo/shared";

export function nextMessageCursor(messages: Message[]): string | null {
  if (messages.length === 0) return null;
  return messages[messages.length - 1]?.id ?? null;
}
