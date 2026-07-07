import type { Message } from "@echoo/shared";

export function getMessagePreview(message: Message): string {
  if (message.content.text) return message.content.text;
  return `[${message.contentType}]`;
}
