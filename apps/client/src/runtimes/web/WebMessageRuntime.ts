import type { AppWsServerEvent, Message } from "@echoo/shared";
import type {
  AuthRuntime,
  ConversationAgentActivityEvent,
  ConversationAgentMuteChangedEvent,
  MessageAudioChunkEvent,
  MessageAudioCompletedEvent,
  MessageAudioFailedEvent,
  MessageAudioStartedEvent,
  MessageDeltaEvent,
  MessageRuntime,
} from "../contracts";

export class WebMessageRuntime implements MessageRuntime {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly messageCreatedHandlers = new Set<
    (message: Message) => void
  >();
  private readonly messageDeltaHandlers = new Set<
    (event: MessageDeltaEvent) => void
  >();
  private readonly messageCompletedHandlers = new Set<
    (message: Message) => void
  >();
  private readonly messageUpdatedHandlers = new Set<(message: Message) => void>();
  private readonly agentActivityHandlers = new Set<
    (event: ConversationAgentActivityEvent) => void
  >();
  private readonly agentMuteChangedHandlers = new Set<
    (event: ConversationAgentMuteChangedEvent) => void
  >();
  private readonly audioStartedHandlers = new Set<
    (event: MessageAudioStartedEvent) => void
  >();
  private readonly audioChunkHandlers = new Set<
    (event: MessageAudioChunkEvent) => void
  >();
  private readonly audioCompletedHandlers = new Set<
    (event: MessageAudioCompletedEvent) => void
  >();
  private readonly audioFailedHandlers = new Set<
    (event: MessageAudioFailedEvent) => void
  >();

  constructor(private readonly auth: AuthRuntime) {}

  async startRealtime(): Promise<void> {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN)
      return this.connectPromise ?? Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const connectPromise = this.openSocket();
    this.connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  private async openSocket(): Promise<void> {
    const url = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws";
    const token = await this.auth.getAccessToken();
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socketUrl = new URL(url);
    if (token) socketUrl.searchParams.set("token", token);

    const socket = new WebSocket(socketUrl);
    this.socket = socket;
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
    };
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as AppWsServerEvent;
      if (payload.type === "conversation.agent_activity") {
        this.agentActivityHandlers.forEach((handler) => handler(payload));
        return;
      }
      if (payload.type === "conversation.agent_mute_changed") {
        this.agentMuteChangedHandlers.forEach((handler) => handler(payload));
        return;
      }
      if (payload.type === "message.created") {
        socket.send(
          JSON.stringify({ type: "ack", messageId: payload.message.id }),
        );
        this.messageCreatedHandlers.forEach((handler) =>
          handler(payload.message),
        );
        return;
      }

      if (payload.type === "message.delta") {
        this.messageDeltaHandlers.forEach((handler) => handler(payload));
        return;
      }

      if (payload.type === "message.completed") {
        socket.send(
          JSON.stringify({ type: "ack", messageId: payload.message.id }),
        );
        this.messageCompletedHandlers.forEach((handler) =>
          handler(payload.message),
        );
        return;
      }
      if (payload.type === "message.updated") {
        this.messageUpdatedHandlers.forEach((handler) => handler(payload.message));
        return;
      }
      if (payload.type === "message.audio.started")
        this.audioStartedHandlers.forEach((handler) => handler(payload));
      else if (payload.type === "message.audio.chunk")
        this.audioChunkHandlers.forEach((handler) => handler(payload));
      else if (payload.type === "message.audio.completed")
        this.audioCompletedHandlers.forEach((handler) => handler(payload));
      else if (payload.type === "message.audio.failed")
        this.audioFailedHandlers.forEach((handler) => handler(payload));
    };
  }

  async stopRealtime(): Promise<void> {
    this.socket?.close(1000, "client stop");
    this.socket = null;
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return this.socket?.readyState === WebSocket.OPEN ? "running" : "stopped";
  }

  onMessageCreated(handler: (message: Message) => void): () => void {
    this.messageCreatedHandlers.add(handler);
    return () => this.messageCreatedHandlers.delete(handler);
  }

  onMessageDelta(handler: (event: MessageDeltaEvent) => void): () => void {
    this.messageDeltaHandlers.add(handler);
    return () => this.messageDeltaHandlers.delete(handler);
  }

  onMessageCompleted(handler: (message: Message) => void): () => void {
    this.messageCompletedHandlers.add(handler);
    return () => this.messageCompletedHandlers.delete(handler);
  }

  onMessageUpdated(handler: (message: Message) => void): () => void {
    this.messageUpdatedHandlers.add(handler);
    return () => this.messageUpdatedHandlers.delete(handler);
  }

  onConversationAgentActivity(
    handler: (event: ConversationAgentActivityEvent) => void,
  ): () => void {
    this.agentActivityHandlers.add(handler);
    return () => this.agentActivityHandlers.delete(handler);
  }

  onConversationAgentMuteChanged(
    handler: (event: ConversationAgentMuteChangedEvent) => void,
  ): () => void {
    this.agentMuteChangedHandlers.add(handler);
    return () => this.agentMuteChangedHandlers.delete(handler);
  }

  onMessageAudioStarted(
    handler: (event: MessageAudioStartedEvent) => void,
  ): () => void {
    this.audioStartedHandlers.add(handler);
    return () => this.audioStartedHandlers.delete(handler);
  }

  onMessageAudioChunk(
    handler: (event: MessageAudioChunkEvent) => void,
  ): () => void {
    this.audioChunkHandlers.add(handler);
    return () => this.audioChunkHandlers.delete(handler);
  }

  onMessageAudioCompleted(
    handler: (event: MessageAudioCompletedEvent) => void,
  ): () => void {
    this.audioCompletedHandlers.add(handler);
    return () => this.audioCompletedHandlers.delete(handler);
  }

  onMessageAudioFailed(
    handler: (event: MessageAudioFailedEvent) => void,
  ): () => void {
    this.audioFailedHandlers.add(handler);
    return () => this.audioFailedHandlers.delete(handler);
  }
}
