import { normalizeInboundMessage } from "../../messaging/message-normalizer.js";

export function mapQqText(text: string) {
  return normalizeInboundMessage({
    interfaceType: "qq",
    conversationId: "conv_qq",
    text
  });
}
