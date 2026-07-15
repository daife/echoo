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
  media?: MediaReference;
}

export interface MessagePageInfo {
  hasOlder: boolean;
  hasNewer: boolean;
  oldestCursor?: string;
  newestCursor?: string;
}

export interface MessagePage {
  items: Message[];
  pageInfo: MessagePageInfo;
}

export type MediaVariant = "original" | "thumb" | "display";

interface MediaReferenceBase {
  resourceId: string;
  variants: MediaVariant[];
}

export type MediaReference =
  | (MediaReferenceBase & {
      kind: "image" | "sticker" | "video";
      width: number;
      height: number;
    })
  | (MediaReferenceBase & {
      kind: "voice" | "file";
    });

export interface MediaAccessItem {
  resourceId: string;
  variant: MediaVariant;
  url: string;
  expiresAt: number;
  mimeType: string;
  byteSize?: number;
  etag?: string;
  width?: number;
  height?: number;
}

export interface MediaUploadTicket {
  resourceId: string;
  status: "pending" | "processing" | "ready" | "failed";
  uploadMethod: "PUT";
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: number;
}

export interface MediaResourceStatus {
  resourceId: string;
  status: "pending" | "processing" | "ready" | "failed" | "deleting";
  mimeType: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
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
      upload?: MessageMediaUpload;
      resourceId?: string;
      clientMessageId?: string;
    }
  | {
      conversationId: string;
      contentType: "voice";
      upload?: MessageMediaUpload;
      resourceId?: string;
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
  /** Client-only layout metadata for optimistic media messages. */
  localMediaDimensions?: {
    width: number;
    height: number;
  };
};
