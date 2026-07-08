import type { Message } from "../types/message";

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
