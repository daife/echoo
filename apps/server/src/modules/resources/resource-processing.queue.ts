import { hostname } from "node:os";
import { createRedisWorker, getRedis } from "../../infra/redis/redis.js";
import { createId } from "../../shared/utils/id.js";
import { ResourceRepository } from "./resource.repository.js";

const STREAM = "echoo:resource-processing";
const GROUP = "echoo-resource-workers";

export class ResourceProcessingQueue {
  private running = false;
  private readonly consumer = `${hostname()}:${process.pid}:${createId("res")}`;
  private lastPendingClaimAt = 0;
  private retryCount = 0;

  constructor(private readonly resources = new ResourceRepository()) {}

  async enqueue(resourceId: string, attempts = 0) {
    const redis = await getRedis();
    await redis.xAdd(
      STREAM,
      "*",
      { resourceId, attempts: String(attempts) },
      {
        TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 50_000 },
      },
    );
  }

  async recoverFromDatabase() {
    for (const resource of await this.resources.listRecoverableUploads())
      await this.enqueue(resource.id);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const redis = await createRedisWorker();
    try {
      await redis.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
    } catch (error) {
      if (!String(error).includes("BUSYGROUP")) throw error;
    }
    while (this.running) {
      if (Date.now() - this.lastPendingClaimAt >= 30_000) {
        this.lastPendingClaimAt = Date.now();
        const claimed = decodeAutoClaim(
          await redis.sendCommand([
            "XAUTOCLAIM",
            STREAM,
            GROUP,
            this.consumer,
            "60000",
            "0-0",
            "COUNT",
            "4",
          ]),
        );
        for (const entry of claimed)
          await this.handle(
            entry.id,
            entry.message.resourceId ?? "",
            Number(entry.message.attempts || 0),
          );
        if (claimed.length) continue;
      }
      const batches = await redis.xReadGroup(
        GROUP,
        this.consumer,
        [{ key: STREAM, id: ">" }],
        { COUNT: 4, BLOCK: 5_000 },
      );
      for (const batch of batches ?? []) {
        for (const entry of batch.messages) {
          await this.handle(
            entry.id,
            entry.message.resourceId,
            Number(entry.message.attempts || 0),
          );
        }
      }
    }
  }

  stop() {
    this.running = false;
  }

  private async handle(entryId: string, resourceId: string, attempts: number) {
    const redis = await getRedis();
    const lockKey = `echoo:resource-lock:${resourceId}`;
    const token = createId("res");
    const acquired = await redis.set(lockKey, token, {
      NX: true,
      PX: 5 * 60_000,
    });
    if (!acquired) {
      await redis.xAck(STREAM, GROUP, entryId);
      return;
    }
    try {
      await this.resources.processUpload(resourceId);
    } catch (error) {
      if (attempts < 3) {
        this.retryCount += 1;
        await delay(retryDelay(attempts));
        await this.enqueue(resourceId, attempts + 1);
      }
      else {
        await this.resources.markProcessingFailed(resourceId);
        await redis.xAdd("echoo:resource-processing:failed", "*", {
          resourceId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } finally {
      if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
      await redis.xAck(STREAM, GROUP, entryId);
    }
  }

  async metrics() {
    const redis = await getRedis();
    const pending = await redis.sendCommand(["XPENDING", STREAM, GROUP]).catch(() => []);
    return {
      pending: Array.isArray(pending) ? Number(pending[0] ?? 0) : 0,
      retries: this.retryCount,
      failed: Number(await redis.xLen("echoo:resource-processing:failed")),
    };
  }
}

function decodeAutoClaim(value: unknown) {
  const entries = Array.isArray(value) && Array.isArray(value[1]) ? value[1] : [];
  return entries.flatMap((raw): Array<{ id: string; message: Record<string, string> }> => {
    if (!Array.isArray(raw) || typeof raw[0] !== "string" || !Array.isArray(raw[1]))
      return [];
    const message: Record<string, string> = {};
    for (let index = 0; index < raw[1].length; index += 2)
      message[String(raw[1][index])] = String(raw[1][index + 1] ?? "");
    return [{ id: raw[0], message }];
  });
}

function retryDelay(attempt: number) {
  const base = [1_000, 5_000, 30_000][attempt] ?? 30_000;
  return base + Math.floor(Math.random() * Math.max(100, base * 0.2));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
