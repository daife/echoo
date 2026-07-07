import type { WebSocket } from "@fastify/websocket";

export class WsSessionManager {
  private readonly sockets = new Set<WebSocket>();

  add(socket: WebSocket) {
    this.sockets.add(socket);
  }

  remove(socket: WebSocket) {
    this.sockets.delete(socket);
  }

  broadcast(payload: unknown) {
    const text = JSON.stringify(payload);
    this.sockets.forEach((socket) => socket.send(text));
  }
}

export const wsSessionManager = new WsSessionManager();
