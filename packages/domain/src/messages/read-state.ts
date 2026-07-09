import type { Message } from "@echoo/shared";

export function isUnread(message: Message): boolean {
  return message.role !== "user" && message.status !== "read";
}
