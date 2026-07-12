import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;
let worker: RedisClientType | null = null;

export async function getRedis() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
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

export async function closeRedis() {
  if (worker?.isOpen) await worker.quit();
  worker = null;
  if (subscriber?.isOpen) await subscriber.quit();
  subscriber = null;
  if (client?.isOpen) await client.quit();
  client = null;
}
