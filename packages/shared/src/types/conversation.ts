export type ConversationType = "direct" | "group" | "agent";

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  agentId?: string;
  externalBindingId?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  pinnedAt?: number;
  updatedAt: number;
  createdAt: number;
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  displayName: string;
  avatarUrl?: string;
  externalIdentityId?: string;
}
