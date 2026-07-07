import { MessageRepository } from "./message.repository.js";

export class MessagingService {
  constructor(private readonly repository = new MessageRepository()) {}

  listMessages(after?: string | null) {
    return this.repository.listAfter(after);
  }

  markRead(messageId: string, readAt: number) {
    return this.repository.markRead(messageId, readAt);
  }
}
