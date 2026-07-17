import { hostname } from "node:os";
import { createRedisWorker, getRedis } from "../../infra/redis/redis.js";
import { ResourceRepository } from "./resource.repository.js";

const STREAM = "echoo:resource-cleanup";
const GROUP = "echoo-resource-cleanup-workers";
const GRACE_MS = 24 * 60 * 60_000;

export class ResourceCleanupQueue {
  private running = false;
  private timer?: NodeJS.Timeout;
  private readonly consumer = `${hostname()}:${process.pid}:cleanup`;

  constructor(private readonly resources = new ResourceRepository()) {}

  async enqueueSweep() {
    const redis = await getRedis();
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const leader = await redis.set(`echoo:resource-cleanup:sweep:${hourBucket}`, this.consumer, {
      NX: true,
      EX: 65 * 60,
    });
    if (!leader) return;
    await redis.xAdd(STREAM, "*", { cutoff: String(Date.now() - GRACE_MS) });
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
    this.timer = setInterval(() => {
      void this.enqueueSweep().catch(() => undefined);
    }, 60 * 60_000);
    this.timer.unref();
    await this.enqueueSweep();
    while (this.running) {
      const batches = await redis.xReadGroup(
        GROUP,
        this.consumer,
        [{ key: STREAM, id: ">" }],
        { COUNT: 1, BLOCK: 5_000 },
      );
      for (const batch of batches ?? []) {
        for (const entry of batch.messages) {
          const cutoff = Number(entry.message.cutoff || Date.now() - GRACE_MS);
          for (const resource of await this.resources.listOrphanedResources(
            cutoff,
          ))
            await this.resources.deleteOrphanedResource(resource.id);
          await redis.xAck(STREAM, GROUP, entry.id);
        }
      }
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }
}
