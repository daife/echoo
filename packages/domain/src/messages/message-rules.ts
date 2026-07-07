import type { Message } from "@echoo/shared";

export function sortMessagesAscending(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => left.createdAt - right.createdAt);
}
