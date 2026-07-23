import { createClient, type RedisClientType } from "redis";
import { environment } from "../config/environment.js";

let client: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;
let worker: RedisClientType | null = null;
const dedicatedWorkers = new Set<RedisClientType>();

export async function getRedis() {
  if (!client) {
    client = createClient({
      url: environment.redisUrl,
    });
    client.on("error", (error) => console.error("Redis error", error));
  }
  if (!client.isOpen) await client.connect();
  return client;
}

export async function getRedisSubscriber() {
  const commandClient = await getRedis();
  if (!subscriber) subscriber = commandClient.duplicate() as RedisClientType;
  if (!subscriber.isOpen) await subscriber.connect();
  return subscriber;
}

export async function getRedisWorker() {
  const commandClient = await getRedis();
  if (!worker) worker = commandClient.duplicate() as RedisClientType;
  if (!worker.isOpen) await worker.connect();
  return worker;
}

export async function createRedisWorker() {
  const commandClient = await getRedis();
  const dedicated = commandClient.duplicate() as RedisClientType;
  dedicated.on("error", (error) => console.error("Redis worker error", error));
  await dedicated.connect();
  dedicatedWorkers.add(dedicated);
  return dedicated;
}

export async function acknowledgeAndDeleteStreamEntry(
  redis: RedisClientType,
  stream: string,
  group: string,
  entryId: string,
) {
  await redis.multi().xAck(stream, group, entryId).xDel(stream, entryId).exec();
}

export async function closeRedis() {
  await Promise.allSettled(
    Array.from(dedicatedWorkers, (dedicated) =>
      dedicated.isOpen ? dedicated.quit() : Promise.resolve(),
    ),
  );
  dedicatedWorkers.clear();
  if (worker?.isOpen) await worker.quit();
  worker = null;
  if (subscriber?.isOpen) await subscriber.quit();
  subscriber = null;
  if (client?.isOpen) await client.quit();
  client = null;
}
