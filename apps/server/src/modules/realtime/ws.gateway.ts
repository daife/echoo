import type { FastifyInstance } from "fastify";
import { AckService } from "./ack.service.js";
import { wsSessionManager } from "./ws-session-manager.js";

export async function registerRealtimeGateway(app: FastifyInstance) {
  const ackService = new AckService();

  app.get("/ws", { websocket: true }, (socket) => {
    wsSessionManager.add(socket);
    socket.send(JSON.stringify({ type: "realtime.ready", connectionId: crypto.randomUUID() }));

    socket.on("message", (raw: Buffer) => {
      const payload = JSON.parse(raw.toString()) as { type?: string; messageId?: string };
      if (payload.type === "ack" && payload.messageId) {
        ackService.acknowledge(payload.messageId);
      }
    });

    socket.on("close", () => wsSessionManager.remove(socket));
  });
}
