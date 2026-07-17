import type { WebSocket } from "@fastify/websocket";

export class WsSessionManager {
  private readonly socketsByUser = new Map<string, Set<WebSocket>>();
  private readonly usersBySocket = new Map<WebSocket, string>();
  private sentBytes = 0;
  private droppedBinaryFrames = 0;

  add(socket: WebSocket, userId: string) {
    const sockets = this.socketsByUser.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.socketsByUser.set(userId, sockets);
    this.usersBySocket.set(socket, userId);
  }

  remove(socket: WebSocket) {
    const userId = this.usersBySocket.get(socket);
    if (!userId) return;
    this.usersBySocket.delete(socket);
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(socket);
    if (!sockets?.size) this.socketsByUser.delete(userId);
  }

  broadcastToUser(userId: string, payload: unknown) {
    const text = JSON.stringify(payload);
    this.socketsByUser.get(userId)?.forEach((socket) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(text);
        this.sentBytes += Buffer.byteLength(text);
      }
    });
  }

  broadcastBinaryToUser(userId: string, header: unknown, data: Buffer) {
    const headerData = Buffer.from(JSON.stringify(header));
    const frame = Buffer.allocUnsafe(4 + headerData.length + data.length);
    frame.writeUInt32BE(headerData.length, 0);
    headerData.copy(frame, 4);
    data.copy(frame, 4 + headerData.length);
    this.socketsByUser.get(userId)?.forEach((socket) => {
      if (socket.readyState === socket.OPEN && socket.bufferedAmount < 4 * 1024 * 1024) {
        socket.send(frame, { binary: true });
        this.sentBytes += frame.length;
      } else if (socket.readyState === socket.OPEN) {
        this.droppedBinaryFrames += 1;
      }
    });
  }

  get connectionCount() {
    return this.usersBySocket.size;
  }

  snapshot() {
    return {
      activeSockets: this.usersBySocket.size,
      activeUsers: this.socketsByUser.size,
      sentBytes: this.sentBytes,
      droppedBinaryFrames: this.droppedBinaryFrames,
    };
  }
}

export const wsSessionManager = new WsSessionManager();
