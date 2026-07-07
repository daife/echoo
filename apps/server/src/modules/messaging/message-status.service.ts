import { MessageRepository } from "./message.repository.js";

export class MessageStatusService {
  constructor(private readonly repository = new MessageRepository()) {}

  markRead(messageId: string, readAt: number) {
    return this.repository.markRead(messageId, readAt);
  }
}
