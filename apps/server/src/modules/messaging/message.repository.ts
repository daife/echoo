import type { Message } from "@echoo/shared";

const messages = new Map<string, Message>();

export class MessageRepository {
  listAfter(after?: string | null): Message[] {
    const all = [...messages.values()].sort((left, right) => left.createdAt - right.createdAt);
    if (!after) return all;
    const index = all.findIndex((message) => message.id === after);
    return index >= 0 ? all.slice(index + 1) : all;
  }

  save(message: Message) {
    messages.set(message.id, message);
    return message;
  }

  markRead(messageId: string, readAt: number) {
    const message = messages.get(messageId);
    if (!message) return null;
    const updated = { ...message, status: "read" as const, readAt, updatedAt: readAt };
    messages.set(messageId, updated);
    return updated;
  }
}

const seedTime = Date.now() - 60_000;
messages.set("msg_seed_1", {
  id: "msg_seed_1",
  conversationId: "conv_aster",
  senderId: "agent_aster",
  direction: "incoming",
  contentType: "text",
  content: { text: "Welcome to Echoo. Your realtime binding is ready." },
  status: "delivered",
  createdAt: seedTime,
  updatedAt: seedTime
});
