import type { ExternalInterfaceType, Message, MessageContentType } from "@echoo/shared";

export function normalizeInboundMessage(input: {
  interfaceType: ExternalInterfaceType;
  conversationId: string;
  senderId: string;
  text: string;
  contentType?: MessageContentType;
}): Message {
  const now = Date.now();
  return {
    id: `msg_${crypto.randomUUID()}`,
    conversationId: input.conversationId,
    senderId: input.senderId,
    direction: "incoming",
    contentType: input.contentType ?? "text",
    content: { text: input.text },
    status: "delivered",
    createdAt: now,
    updatedAt: now
  };
}
