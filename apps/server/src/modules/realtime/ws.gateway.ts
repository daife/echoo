import type { FastifyInstance } from "fastify";
import { wsSessionManager } from "./ws-session-manager.js";
import { ChangeEventRepository } from "../sync/change-event.repository.js";

export async function registerRealtimeGateway(app: FastifyInstance) {
  const events = new ChangeEventRepository();

  app.post("/api/realtime/ticket", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return {
      ticket: app.jwt.sign(
        { sub: userId, type: "realtime-ticket", jti: crypto.randomUUID() },
        { expiresIn: "30s" },
      ),
      expiresAt: Date.now() + 30_000,
    };
  });

  app.get<{ Querystring: { ticket?: string } }>(
    "/ws",
    { websocket: true },
    async (socket, request) => {
      let userId: string;
      try {
        const payload = app.jwt.verify<{ sub: string; type?: string }>(
          request.query.ticket ?? "",
        );
        if (payload.type !== "realtime-ticket") throw new Error("bad ticket");
        userId = payload.sub;
      } catch {
        socket.close(1008, "authentication required");
        return;
      }

      wsSessionManager.add(socket, userId);
      socket.send(
        JSON.stringify({
          type: "realtime.ready",
          connectionId: crypto.randomUUID(),
          protocolVersion: 2,
          headCursor: await events.head(userId),
        }),
      );

      socket.on("message", (raw: Buffer) => {
        const payload = safeParse(raw);
        if (payload.type === "ping") socket.pong();
      });

      socket.on("close", () => wsSessionManager.remove(socket));
    },
  );
}

function safeParse(raw: Buffer): { type?: string } {
  try {
    return JSON.parse(raw.toString()) as { type?: string };
  } catch {
    return {};
  }
}
