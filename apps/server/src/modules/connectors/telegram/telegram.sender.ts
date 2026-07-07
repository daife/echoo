import type { Message } from "@echoo/shared";

export class TelegramSender {
  async send(_message: Message) {
    return { externalMessageId: `tg_${Date.now()}` };
  }
}
