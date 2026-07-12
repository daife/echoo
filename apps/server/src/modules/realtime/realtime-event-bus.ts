import { randomUUID } from "node:crypto";
import { getRedis, getRedisSubscriber } from "../../infra/redis/redis.js";
import { wsSessionManager } from "./ws-session-manager.js";

const CHANNEL = "echoo:realtime";
const instanceId = randomUUID();

export async function startRealtimeEventBus() {
  const subscriber = await getRedisSubscriber();
  await subscriber.subscribe(CHANNEL, (raw) => {
    try {
      const event = JSON.parse(raw) as { source: string; userId?: string; payload: unknown };
      if (event.source === instanceId) return;
      if (event.userId) wsSessionManager.broadcastToUser(event.userId, event.payload);
      else wsSessionManager.broadcast(event.payload);
    } catch { /* discard malformed broker events */ }
  });
}

export function publishRealtime(userId: string | null, payload: unknown) {
  wsSessionManager.broadcastToUser(userId ?? "", payload);
  if (!userId) wsSessionManager.broadcast(payload);
  void getRedis().then((redis) => redis.publish(CHANNEL,
    JSON.stringify({ source: instanceId, ...(userId ? { userId } : {}), payload })))
    .catch((error) => console.error("Realtime publish failed", error));
}
