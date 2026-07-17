import { randomUUID } from "node:crypto";
import { getRedis, getRedisSubscriber } from "../../infra/redis/redis.js";
import { wsSessionManager } from "./ws-session-manager.js";

const CHANNEL = "echoo:realtime";
const instanceId = randomUUID();

export async function startRealtimeEventBus() {
  const subscriber = await getRedisSubscriber();
  await subscriber.subscribe(CHANNEL, (raw) => {
    try {
      const event = JSON.parse(raw) as {
        source: string;
        userId?: string;
        payload: unknown;
        binary?: { header: unknown; dataBase64: string };
      };
      if (event.source === instanceId) return;
      if (event.userId && event.binary)
        wsSessionManager.broadcastBinaryToUser(
          event.userId,
          event.binary.header,
          Buffer.from(event.binary.dataBase64, "base64"),
        );
      else if (event.userId)
        wsSessionManager.broadcastToUser(event.userId, event.payload);
    } catch {
      /* discard malformed broker events */
    }
  });
}

export function publishRealtimeBinary(
  userId: string,
  header: unknown,
  data: Buffer,
) {
  wsSessionManager.broadcastBinaryToUser(userId, header, data);
  void getRedis()
    .then((redis) =>
      redis.publish(
        CHANNEL,
        JSON.stringify({
          source: instanceId,
          userId,
          payload: null,
          binary: { header, dataBase64: data.toString("base64") },
        }),
      ),
    )
    .catch((error) => console.error("Realtime binary publish failed", error));
}

export function publishRealtime(userId: string | null, payload: unknown) {
  if (!userId) return;
  wsSessionManager.broadcastToUser(userId, payload);
  void getRedis()
    .then((redis) =>
      redis.publish(
        CHANNEL,
        JSON.stringify({
          source: instanceId,
          ...(userId ? { userId } : {}),
          payload,
        }),
      ),
    )
    .catch((error) => console.error("Realtime publish failed", error));
}

export async function publishDurableRealtime(userId: string, payload: unknown) {
  wsSessionManager.broadcastToUser(userId, payload);
  const redis = await getRedis();
  await redis.publish(
    CHANNEL,
    JSON.stringify({ source: instanceId, userId, payload }),
  );
}
