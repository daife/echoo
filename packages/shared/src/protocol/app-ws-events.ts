import type { Message } from "../types/message.js";

export type AppWsServerEvent =
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
      type: "message.audio.started";
      messageId: string;
      conversationId: string;
      mimeType: string;
    }
  | {
      type: "message.audio.chunk";
      messageId: string;
      conversationId: string;
      sequence: number;
      dataBase64: string;
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
    };

export type AppWsClientEvent =
  | {
      type: "ack";
      messageId: string;
    }
  | {
      type: "ping";
      sentAt: number;
    };
