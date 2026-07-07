import type { Connector } from "../connector.interface.js";
import { QqSender } from "./qq.sender.js";

export class QqConnector implements Connector {
  type = "qq" as const;
  private readonly sender = new QqSender();
  capability = {
    canReceiveMessage: true,
    canSendMessage: true,
    canSendImage: false,
    canSendFile: false,
    canRecallMessage: false,
    supportsReadReceipt: false,
    supportsDeliveryReceipt: true,
    requiresReplyWindow: true
  };

  sendMessage = this.sender.send.bind(this.sender);
}
