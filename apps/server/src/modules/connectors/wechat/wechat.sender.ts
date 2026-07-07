import type { Message } from "@echoo/shared";

export class WechatSender {
  async send(_message: Message) {
    return { externalMessageId: `wx_${Date.now()}` };
  }
}
