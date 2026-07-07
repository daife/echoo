import type { Message } from "@echoo/shared";

export class MessageSearchService {
  search(messages: Message[], query: string) {
    return messages.filter((message) => message.content.text?.toLowerCase().includes(query.toLowerCase()));
  }
}
