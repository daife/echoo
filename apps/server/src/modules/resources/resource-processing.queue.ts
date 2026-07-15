import { hostname } from "node:os";
import { createRedisWorker, getRedis } from "../../infra/redis/redis.js";
import { createId } from "../../shared/utils/id.js";
import { ResourceRepository } from "./resource.repository.js";

const STREAM = "echoo:resource-processing";
const GROUP = "echoo-resource-workers";

export class ResourceProcessingQueue {
  private running = false;
  private readonly consumer = `${hostname()}:${process.pid}:${createId("res")}`;

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
      if (attempts < 3) await this.enqueue(resourceId, attempts + 1);
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
}
