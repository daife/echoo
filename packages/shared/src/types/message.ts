export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "sent" | "delivered" | "failed" | "read";
export type MessageContentType = "text" | "image" | "file" | "voice" | "video" | "system";

export interface MessageContent {
  text?: string;
  mediaUrl?: string;
  fileName?: string;
}

export interface Message {
  id: string;
  clientMessageId?: string;
  /**
   * Persistent session id for the conversation this message belongs to.
   */
  conversationId: string;
  role: MessageRole;
  contentType: MessageContentType;
  content: MessageContent;
  status: MessageStatus;
  providerId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  readAt?: number;
}

export type LocalMessage = Message & {
  syncStatus: "synced" | "pending" | "failed";
};
