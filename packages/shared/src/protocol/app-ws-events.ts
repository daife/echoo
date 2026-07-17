import type { Message } from "../types/message.js";
import type { SyncChange, SyncCursor } from "../types/sync.js";

export type AppWsServerEvent =
  | {
      type: "sync.change";
      change: SyncChange;
    }
  | {
      type: "conversation.agent_activity";
      conversationId: string;
      active: boolean;
      updatedAt: number;
      expiresAt?: number;
    }
  | {
      type: "conversation.agent_mute_changed";
      conversationId: string;
      muteUntilMs: number | null;
      updatedAt: number;
    }
  | {
      type: "message.created";
      message: Message;
    }
  | {
      type: "message.delta";
      messageId: string;
      conversationId: string;
      delta: string;
      updatedAt: number;
    }
  | {
      type: "message.completed";
      message: Message;
    }
  | {
      type: "message.updated";
      message: Message;
    }
  | {
      type: "message.audio.started";
      messageId: string;
      conversationId: string;
      mimeType: string;
    }
  | {
      type: "message.audio.completed";
      messageId: string;
      conversationId: string;
      mediaUrl?: string;
    }
  | {
      type: "message.audio.failed";
      messageId: string;
      conversationId: string;
      error: string;
    }
  | {
      type: "message.status_changed";
      messageId: string;
      status: "sent" | "delivered" | "failed" | "read";
      updatedAt: number;
    }
  | {
      type: "realtime.ready";
      connectionId: string;
      protocolVersion: 2;
      headCursor: SyncCursor;
    };

export type AppWsClientEvent = { type: "ping"; sentAt: number };

export type DurableWsEvent = Extract<AppWsServerEvent, { type: "sync.change" }>;

export interface BinaryWsFrameHeader {
  type: "message.audio.chunk";
  messageId: string;
  conversationId: string;
  sequence: number;
}
