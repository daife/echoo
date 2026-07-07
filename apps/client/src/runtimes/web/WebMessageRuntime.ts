import type { AppWsServerEvent } from "@echoo/shared";
import type { AuthRuntime, MessageRuntime } from "../contracts";

export class WebMessageRuntime implements MessageRuntime {
  private socket: WebSocket | null = null;

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
        this.socket?.send(JSON.stringify({ type: "ack", messageId: payload.messageId }));
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
}
