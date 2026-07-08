import type { AppWsServerEvent, Message } from "@echoo/shared";
import type { AuthRuntime, MessageDeltaEvent, MessageRuntime } from "../contracts";

export class WebMessageRuntime implements MessageRuntime {
  private socket: WebSocket | null = null;
  private readonly messageCreatedHandlers = new Set<(message: Message) => void>();
  private readonly messageDeltaHandlers = new Set<(event: MessageDeltaEvent) => void>();
  private readonly messageCompletedHandlers = new Set<(message: Message) => void>();

  constructor(private readonly auth: AuthRuntime) {}

  async startRealtime(): Promise<void> {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const url = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws";
    const token = await this.auth.getAccessToken();
    const socketUrl = new URL(url);
    if (token) socketUrl.searchParams.set("token", token);

    this.socket = new WebSocket(socketUrl);
    this.socket.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as AppWsServerEvent;
      if (payload.type === "message.created") {
        this.socket?.send(JSON.stringify({ type: "ack", messageId: payload.message.id }));
        this.messageCreatedHandlers.forEach((handler) => handler(payload.message));
        return;
      }

      if (payload.type === "message.delta") {
        this.messageDeltaHandlers.forEach((handler) => handler(payload));
        return;
      }

      if (payload.type === "message.completed") {
        this.socket?.send(JSON.stringify({ type: "ack", messageId: payload.message.id }));
        this.messageCompletedHandlers.forEach((handler) => handler(payload.message));
      }
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
}
