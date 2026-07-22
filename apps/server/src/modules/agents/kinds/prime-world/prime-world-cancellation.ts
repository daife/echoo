import { getRedis, getRedisSubscriber } from "../../../../infra/redis/redis.js";

const CHANNEL = "echoo:prime-world:cancel";
const controllers = new Map<string, AbortController>();
let subscription: Promise<void> | undefined;

export async function registerPrimeWorldCancellation(runId: string, controller: AbortController) {
  controllers.set(runId, controller);
  await ensureSubscription().catch((error) =>
    console.error("Prime World cancellation subscription failed", error),
  );
  return () => controllers.delete(runId);
}

export async function publishPrimeWorldCancellation(runId: string) {
  controllers.get(runId)?.abort();
  try {
    const redis = await getRedis();
    await redis.publish(CHANNEL, runId);
  } catch (error) {
    console.error("Prime World cancellation publish failed", error);
  }
}

async function ensureSubscription() {
  if (subscription) return subscription;
  subscription = (async () => {
    const subscriber = await getRedisSubscriber();
    await subscriber.subscribe(CHANNEL, (runId) => controllers.get(runId)?.abort());
  })();
  try {
    await subscription;
  } catch (error) {
    subscription = undefined;
    throw error;
  }
}
