import type { Message } from "@echoo/shared";

export class QqSender {
  async send(_message: Message) {
    return { externalMessageId: `qq_${Date.now()}` };
  }
}
