import type { Message } from "@echoo/shared";

export function isUnread(message: Message): boolean {
  return message.direction === "incoming" && message.status !== "read";
}
