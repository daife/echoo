import type { AppWsServerEvent, Message } from "@echoo/shared";

export type MessageDeltaEvent = Extract<AppWsServerEvent, { type: "message.delta" }>;

export interface MessageRuntime {
  startRealtime(): Promise<void>;
  stopRealtime(): Promise<void>;
  getStatus(): Promise<"running" | "stopped" | "unsupported">;
  onMessageCreated(handler: (message: Message) => void): () => void;
  onMessageDelta(handler: (event: MessageDeltaEvent) => void): () => void;
  onMessageCompleted(handler: (message: Message) => void): () => void;
}
