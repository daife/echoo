import type {
  AppWsServerEvent,
  Message,
  PrimeWorldRealtimeEvent,
  SyncChange,
} from "@echoo/shared";

export type MessageDeltaEvent = Extract<
  AppWsServerEvent,
  { type: "message.delta" }
>;
export type MessageAudioStartedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.started" }
>;
export type MessageAudioChunkEvent = {
  type: "message.audio.chunk";
  messageId: string;
  conversationId: string;
  sequence: number;
  data: Uint8Array;
};
export type MessageAudioCompletedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.completed" }
>;
export type MessageAudioFailedEvent = Extract<
  AppWsServerEvent,
  { type: "message.audio.failed" }
>;
export type ConversationAgentActivityEvent = Extract<
  AppWsServerEvent,
  { type: "conversation.agent_activity" }
>;
export type ConversationAgentMuteChangedEvent = Extract<
  AppWsServerEvent,
  { type: "conversation.agent_mute_changed" }
>;
export type PrimeWorldAudioChunkEvent = {
  type: "world.audio.chunk";
  conversationId: string;
  runId: string;
  nodeId: string;
  port: string;
  sequence: number;
  mimeType: string;
  data: Uint8Array;
};

export interface MessageRuntime {
  startRealtime(): Promise<void>;
  stopRealtime(): Promise<void>;
  getStatus(): Promise<"running" | "stopped" | "unsupported">;
  getSyncStatus(): "stopped" | "connecting" | "syncing" | "live";
  onSyncStatusChange(
    handler: (status: "stopped" | "connecting" | "syncing" | "live") => void,
  ): () => void;
  getSyncCursor(): Promise<number>;
  onSyncChange(handler: (change: SyncChange) => void): () => void;
  onSyncReset(handler: () => void): () => void;
  onMessageCreated(handler: (message: Message) => void): () => void;
  onMessageDelta(handler: (event: MessageDeltaEvent) => void): () => void;
  onMessageCompleted(handler: (message: Message) => void): () => void;
  onMessageUpdated(handler: (message: Message) => void): () => void;
  onConversationAgentActivity(
    handler: (event: ConversationAgentActivityEvent) => void,
  ): () => void;
  onConversationAgentMuteChanged(
    handler: (event: ConversationAgentMuteChangedEvent) => void,
  ): () => void;
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
  onPrimeWorldEvent(
    handler: (event: PrimeWorldRealtimeEvent) => void,
  ): () => void;
  onPrimeWorldAudioChunk(
    handler: (event: PrimeWorldAudioChunkEvent) => void,
  ): () => void;
}
