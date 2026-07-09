import { normalizeInboundMessage } from "../../messaging/message-normalizer.js";

export function mapTelegramText(text: string) {
  return normalizeInboundMessage({
    interfaceType: "telegram",
    conversationId: "conv_telegram",
    text
  });
}
