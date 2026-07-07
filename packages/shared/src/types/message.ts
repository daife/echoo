export type MessageDirection = "incoming" | "outgoing";
export type MessageStatus = "pending" | "sent" | "delivered" | "failed" | "read";
export type MessageContentType = "text" | "image" | "file" | "voice" | "video" | "system";

export interface MessageContent {
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  raw?: unknown;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  direction: MessageDirection;
  contentType: MessageContentType;
  content: MessageContent;
  status: MessageStatus;
  createdAt: number;
  updatedAt: number;
  readAt?: number;
}

export type LocalMessage = Message & {
  syncStatus: "synced" | "pending" | "failed";
};
