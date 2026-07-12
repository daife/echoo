import { hostname } from "node:os";
import { createId } from "../../shared/utils/id.js";
import { getRedis, getRedisWorker } from "./redis.js";

const STREAM = "echoo:agent-runs";
const GROUP = "echoo-server";

export interface AgentRunJob {
  id?: string;
  ownerUserId: string;
  conversationId: string;
  kind: "slice-figure" | "prime-figure";
  assistantMessageId?: string;
  attempts?: number;
  trigger?: "end_user_message" | "silence_ended" | "coalesced_messages";
}

export class AgentRunQueue {
  private running = false;
  private readonly consumer = `${hostname()}:${process.pid}:${createId("msg")}`;

  async enqueue(job: AgentRunJob) {
    const redis = await getRedis();
    await redis.xAdd(STREAM, "*", {
      ownerUserId: job.ownerUserId,
      conversationId: job.conversationId,
      kind: job.kind,
      assistantMessageId: job.assistantMessageId ?? "",
      attempts: String(job.attempts ?? 0),
      trigger: job.trigger ?? "end_user_message",
    }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 100_000 } });
  }

  async start(handler: (job: AgentRunJob) => Promise<void>) {
    if (this.running) return;
    this.running = true;
    const redis = await getRedisWorker();
    try { await redis.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true }); }
    catch (error) { if (!String(error).includes("BUSYGROUP")) throw error; }

    while (this.running) {
      const batches = await redis.xReadGroup(GROUP, this.consumer,
        [{ key: STREAM, id: ">" }], { COUNT: 8, BLOCK: 5_000 });
      for (const batch of batches ?? []) {
        for (const entry of batch.messages) {
          const job = { id: entry.id, ownerUserId: entry.message.ownerUserId,
            conversationId: entry.message.conversationId,
            kind: entry.message.kind as AgentRunJob["kind"],
            attempts: Number(entry.message.attempts || 0),
            trigger: entry.message.trigger as AgentRunJob["trigger"],
            ...(entry.message.assistantMessageId ? { assistantMessageId: entry.message.assistantMessageId } : {}) };
          try {
            await this.process(redis, job, handler);
          } catch (error) {
            if ((job.attempts ?? 0) < 3) {
              await this.enqueue({ ...job, attempts: (job.attempts ?? 0) + 1 });
            } else {
              await redis.xAdd("echoo:agent-runs:failed", "*", {
                job: JSON.stringify(job),
                error: error instanceof Error ? error.message : "Unknown run error",
              });
            }
          }
          await redis.xAck(STREAM, GROUP, entry.id);
        }
      }
    }
  }

  stop() { this.running = false; }

  private async process(redis: Awaited<ReturnType<typeof getRedis>>, job: AgentRunJob,
    handler: (job: AgentRunJob) => Promise<void>) {
    const lockKey = `echoo:run-lock:${job.conversationId}`;
    const dirtyKey = `echoo:run-dirty:${job.conversationId}`;
    const token = createId("msg");
    const acquired = await redis.set(lockKey, token, { NX: true, PX: 10 * 60_000 });
    if (!acquired) { await redis.set(dirtyKey, "1", { EX: 10 * 60 }); return; }
    try {
      do {
        await redis.del(dirtyKey);
        await handler(job);
      } while (await redis.getDel(dirtyKey));
    } finally {
      if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
    }
  }
}
