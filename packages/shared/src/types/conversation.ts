export type ConversationType = "direct" | "group" | "slice-figure" | "prime-figure";

export interface Conversation {
  /**
   * Persistent session id. One user conversation keeps this id for its lifetime.
   */
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
