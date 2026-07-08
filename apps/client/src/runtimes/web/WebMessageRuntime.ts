import type { AppWsServerEvent, Message } from "@echoo/shared";
import type { AuthRuntime, MessageRuntime } from "../contracts";

export class WebMessageRuntime implements MessageRuntime {
  private socket: WebSocket | null = null;
  private readonly messageCreatedHandlers = new Set<(message: Message) => void>();

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
}
