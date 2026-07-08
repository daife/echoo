import { MessageRepository } from "./message.repository.js";

export class MessageStatusService {
  constructor(private readonly repository = new MessageRepository()) {}

  markRead(ownerUserId: string, messageId: string, readAt: number) {
    return this.repository.markRead(ownerUserId, messageId, readAt);
  }
}
