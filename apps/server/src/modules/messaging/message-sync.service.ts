import { MessageRepository } from "./message.repository.js";

export class MessageSyncService {
  constructor(private readonly repository = new MessageRepository()) {}

  listMessagesAfter(after?: string | null) {
    return this.repository.listAfter(after);
  }
}
