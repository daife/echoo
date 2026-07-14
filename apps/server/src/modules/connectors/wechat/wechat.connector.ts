import type { Connector } from "../connector.interface.js";
import { WechatSender } from "./wechat.sender.js";

export class WechatConnector implements Connector {
  type = "wechat" as const;
  private readonly sender = new WechatSender();
  capability = {
    canReceiveMessage: true,
    canSendMessage: true,
    canSendImage: true,
    canSendFile: false,
    canRecallMessage: false,
    supportsReadReceipt: false,
    supportsDeliveryReceipt: false,
    requiresReplyWindow: true,
  };

  sendMessage = this.sender.send.bind(this.sender);
}
