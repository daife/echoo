import type { Message } from "@echoo/shared";

export interface MessageRuntime {
  startRealtime(): Promise<void>;
  stopRealtime(): Promise<void>;
  getStatus(): Promise<"running" | "stopped" | "unsupported">;
  onMessageCreated(handler: (message: Message) => void): () => void;
}
