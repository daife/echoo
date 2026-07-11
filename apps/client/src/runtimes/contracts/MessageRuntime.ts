import type { AppWsServerEvent, Message } from "@echoo/shared";

export type MessageDeltaEvent = Extract<
  AppWsServerEvent,
  { type: "message.delta" }
>;
export type MessageAudioStartedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.started" }
>;
export type MessageAudioChunkEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.chunk" }
>;
export type MessageAudioCompletedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.completed" }
>;
export type MessageAudioFailedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.failed" }
>;

export interface MessageRuntime {
  startRealtime(): Promise<void>;
  stopRealtime(): Promise<void>;
  getStatus(): Promise<"running" | "stopped" | "unsupported">;
  onMessageCreated(handler: (message: Message) => void): () => void;
  onMessageDelta(handler: (event: MessageDeltaEvent) => void): () => void;
  onMessageCompleted(handler: (message: Message) => void): () => void;
  onMessageAudioStarted(
    handler: (event: MessageAudioStartedEvent) => void,
  ): () => void;
  onMessageAudioChunk(
    handler: (event: MessageAudioChunkEvent) => void,
  ): () => void;
  onMessageAudioCompleted(
    handler: (event: MessageAudioCompletedEvent) => void,
  ): () => void;
  onMessageAudioFailed(
    handler: (event: MessageAudioFailedEvent) => void,
  ): () => void;
}
