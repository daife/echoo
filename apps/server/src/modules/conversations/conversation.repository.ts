import type { Conversation } from "@echoo/shared";

const conversations: Conversation[] = [
  {
    id: "conv_aster",
    title: "Aster",
    type: "agent",
    agentId: "agent_aster",
    externalBindingId: "binding_01",
    lastMessagePreview: "Welcome to Echoo.",
    unreadCount: 1,
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 60_000
  }
];

export class ConversationRepository {
  list() {
    return conversations;
  }
}
