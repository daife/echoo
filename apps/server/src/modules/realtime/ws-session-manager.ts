import type { WebSocket } from "@fastify/websocket";

export class WsSessionManager {
  private readonly sockets = new Map<WebSocket, string | null>();

  add(socket: WebSocket, userId: string | null) {
    this.sockets.set(socket, userId);
  }

  remove(socket: WebSocket) {
    this.sockets.delete(socket);
  }

  broadcast(payload: unknown) {
    const text = JSON.stringify(payload);
    this.sockets.forEach((_userId, socket) => socket.send(text));
  }

  broadcastToUser(userId: string, payload: unknown) {
    const text = JSON.stringify(payload);
    this.sockets.forEach((socketUserId, socket) => {
      if (socketUserId === userId) socket.send(text);
    });
  }
}

export const wsSessionManager = new WsSessionManager();
