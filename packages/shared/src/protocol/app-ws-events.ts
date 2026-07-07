export type AppWsServerEvent =
  | {
      type: "message.created";
      messageId: string;
      conversationId: string;
      title: string;
      body: string;
      createdAt: number;
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
