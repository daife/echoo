import type { FastifyInstance } from "fastify";
import { AckService } from "./ack.service.js";
import { wsSessionManager } from "./ws-session-manager.js";

export async function registerRealtimeGateway(app: FastifyInstance) {
  const ackService = new AckService();

  app.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket, request) => {
    let userId: string | null = null;
    if (request.query.token) {
      try {
        const payload = app.jwt.verify<{ sub: string }>(request.query.token);
        userId = payload.sub;
      } catch {
        userId = null;
      }
    }

    wsSessionManager.add(socket, userId);
    socket.send(JSON.stringify({ type: "realtime.ready", connectionId: crypto.randomUUID() }));

    socket.on("message", (raw: Buffer) => {
      const payload = safeParse(raw);
      if (payload.type === "ack" && payload.messageId) {
        ackService.acknowledge(payload.messageId);
      }
    });

    socket.on("close", () => wsSessionManager.remove(socket));
  });
}

function safeParse(raw: Buffer): { type?: string; messageId?: string } {
  try {
    return JSON.parse(raw.toString()) as { type?: string; messageId?: string };
  } catch {
    return {};
  }
}
