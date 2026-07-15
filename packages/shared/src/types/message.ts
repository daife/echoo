export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus =
  "pending" | "sent" | "delivered" | "failed" | "read";
export type MessageContentType =
  "text" | "image" | "file" | "voice" | "video" | "system";

export interface MessageContent {
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  /** Server-side resource backing a media message. */
  resourceId?: string;
}

export interface MessageMediaUpload {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export type CreateMediaMessageInput =
  | {
      conversationId: string;
      contentType: "image";
      upload: MessageMediaUpload;
      clientMessageId?: string;
    }
  | {
      conversationId: string;
      contentType: "voice";
      upload: MessageMediaUpload;
      durationSeconds: number;
      clientMessageId?: string;
    }
  | {
      conversationId: string;
      contentType: "sticker";
      stickerId: string;
      clientMessageId?: string;
    }
  | {
      conversationId: string;
      contentType: "transfer";
      amount: number;
      currency: "CNY";
      note?: string;
      clientMessageId?: string;
    };

export interface ResolveTransferInput {
  conversationId: string;
  messageId: string;
  resolution: "accepted" | "rejected";
}

export interface Message {
  id: string;
  /** Stable database timeline sequence. */
  sequence?: number;
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
