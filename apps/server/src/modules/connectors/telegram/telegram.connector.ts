import type { Connector } from "../connector.interface.js";
import { TelegramSender } from "./telegram.sender.js";

export class TelegramConnector implements Connector {
  type = "telegram" as const;
  private readonly sender = new TelegramSender();
  capability = {
    canReceiveMessage: true,
    canSendMessage: true,
    canSendImage: true,
    canSendFile: true,
    canRecallMessage: false,
    supportsReadReceipt: false,
    supportsDeliveryReceipt: true,
    requiresReplyWindow: false
  };

  sendMessage = this.sender.send.bind(this.sender);
}
