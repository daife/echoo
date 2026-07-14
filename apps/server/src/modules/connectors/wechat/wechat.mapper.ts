import { normalizeInboundMessage } from "../../messaging/message-normalizer.js";

export function mapWechatText(text: string) {
  return normalizeInboundMessage({
    interfaceType: "wechat",
    conversationId: "conv_wechat",
    text,
  });
}
