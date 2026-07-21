import { hostname } from "node:os";
import { environment } from "../config/environment.js";
import { createId } from "../../shared/utils/id.js";
import { getRedis, getRedisWorker } from "./redis.js";

const STREAM = "echoo:agent-runs";
const GROUP = "echoo-server";
const CANCELLED_TTL_SECONDS = 24 * 60 * 60;

export interface AgentRunJob {
  id?: string;
  ownerUserId: string;
  conversationId: string;
  kind: "slice-figure" | "prime-figure" | "prime-world";
  runId?: string;
  assistantMessageId?: string;
  attempts?: number;
  trigger?:
    | "end_user_message"
    | "mute_ended"
    | "scheduled_wakeup"
    | "passive_wakeup"
    | "coalesced_messages"
    | "debug_hint"
    | "memory_summary";
  debugInstruction?: string;
  wakeupToken?: string;
  passiveStage?: 1 | 2 | 3;
}

export interface AgentRunActivity {
  ownerUserId: string;
  conversationId: string;
  active: boolean;
}

export class AgentRunQueue {
  private running = false;
  private readonly consumer = `${hostname()}:${process.pid}:${createId("msg")}`;
  private readonly inFlight = new Set<Promise<void>>();
  private lastPendingClaimAt = 0;
  private retryCount = 0;

  async enqueue(job: AgentRunJob) {
    const redis = await getRedis();
    if (await redis.exists(this.cancelledKey(job.conversationId))) return;
    await redis.xAdd(
      STREAM,
      "*",
      {
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        kind: job.kind,
        runId: job.runId ?? "",
        assistantMessageId: job.assistantMessageId ?? "",
        attempts: String(job.attempts ?? 0),
        trigger: job.trigger ?? "end_user_message",
        debugInstruction: job.debugInstruction ?? "",
        wakeupToken: job.wakeupToken ?? "",
        passiveStage: job.passiveStage ? String(job.passiveStage) : "",
      },
      {
        TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 100_000 },
      },
    );
  }

  async cancelConversation(conversationId: string) {
    const redis = await getRedis();
    await redis
      .multi()
      .set(this.cancelledKey(conversationId), "1", {
        EX: CANCELLED_TTL_SECONDS,
      })
      .del(`echoo:run-dirty:${conversationId}`)
      .exec();
  }

  async start(
    handler: (job: AgentRunJob) => Promise<void>,
    onActivity?: (activity: AgentRunActivity) => void,
  ) {
    if (this.running) return;
    this.running = true;
    const redis = await getRedisWorker();
    try {
      await redis.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
    } catch (error) {
      if (!String(error).includes("BUSYGROUP")) throw error;
    }

    const concurrency = environment.agentRunConcurrency;
    while (this.running) {
      if (this.inFlight.size >= concurrency) {
        await Promise.race(this.inFlight);
        continue;
      }
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
            String(concurrency - this.inFlight.size),
          ]),
        );
        for (const entry of claimed)
          this.startEntry(entry, handler, onActivity);
        if (claimed.length) continue;
      }
      const batches = await redis.xReadGroup(
        GROUP,
        this.consumer,
        [{ key: STREAM, id: ">" }],
        {
          COUNT: concurrency - this.inFlight.size,
          BLOCK: 5_000,
        },
      );
      for (const batch of batches ?? []) {
        for (const entry of batch.messages) {
          this.startEntry(entry, handler, onActivity);
        }
      }
    }
    await Promise.allSettled(this.inFlight);
  }

  stop() {
    this.running = false;
  }

  private startEntry(
    entry: { id: string; message: Record<string, string> },
    handler: (job: AgentRunJob) => Promise<void>,
    onActivity?: (activity: AgentRunActivity) => void,
  ) {
    const job = toJob(entry);
    const task = this.handleEntry(job, entry.id, handler, onActivity).finally(
      () => this.inFlight.delete(task),
    );
    this.inFlight.add(task);
  }

  private async handleEntry(
    job: AgentRunJob,
    entryId: string,
    handler: (job: AgentRunJob) => Promise<void>,
    onActivity?: (activity: AgentRunActivity) => void,
  ) {
    const redis = await getRedis();
    try {
      await this.process(redis, job, handler, onActivity);
    } catch (error) {
      if ((job.attempts ?? 0) < 3) {
        this.retryCount += 1;
        await delay(retryDelay(job.attempts ?? 0));
        await this.enqueue({ ...job, attempts: (job.attempts ?? 0) + 1 });
      } else {
        await redis.xAdd("echoo:agent-runs:failed", "*", {
          job: JSON.stringify(job),
          error: error instanceof Error ? error.message : "Unknown run error",
        });
      }
    }
    await redis.xAck(STREAM, GROUP, entryId);
  }

  private async process(
    redis: Awaited<ReturnType<typeof getRedis>>,
    job: AgentRunJob,
    handler: (job: AgentRunJob) => Promise<void>,
    onActivity?: (activity: AgentRunActivity) => void,
  ) {
    if (await redis.exists(this.cancelledKey(job.conversationId))) return;
    const lockKey = `echoo:run-lock:${job.conversationId}`;
    const dirtyKey = `echoo:run-dirty:${job.conversationId}`;
    const token = createId("msg");
    const acquired = await redis.set(lockKey, token, {
      NX: true,
      PX: 10 * 60_000,
    });
    if (!acquired) {
      if (
        job.kind === "prime-figure" &&
        job.trigger !== "debug_hint" &&
        job.trigger !== "scheduled_wakeup" &&
        job.trigger !== "passive_wakeup"
      ) {
        await redis.set(dirtyKey, "1", { EX: 10 * 60 });
      } else {
        await delay(
          job.trigger === "scheduled_wakeup" || job.trigger === "passive_wakeup"
            ? 5_000
            : 100,
        );
        await this.enqueue(job);
      }
      return;
    }
    const heartbeat = setInterval(() => {
      void renewLock(redis, lockKey, token);
    }, 30_000);
    heartbeat.unref();
    if (job.kind !== "prime-figure")
      onActivity?.({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        active: true,
      });
    try {
      let currentJob = job;
      do {
        await redis.del(dirtyKey);
        if (await redis.exists(this.cancelledKey(job.conversationId))) return;
        await handler(currentJob);
        currentJob = {
          ...job,
          trigger: "coalesced_messages",
          debugInstruction: undefined,
          wakeupToken: undefined,
          passiveStage: undefined,
        };
      } while (job.kind === "prime-figure" && (await redis.getDel(dirtyKey)));
    } finally {
      clearInterval(heartbeat);
      if (job.kind !== "prime-figure")
        onActivity?.({
          ownerUserId: job.ownerUserId,
          conversationId: job.conversationId,
          active: false,
        });
      if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
    }
  }

  private cancelledKey(conversationId: string) {
    return `echoo:run-cancelled:${conversationId}`;
  }

  async metrics() {
    const redis = await getRedis();
    const pending = await redis
      .sendCommand(["XPENDING", STREAM, GROUP])
      .catch(() => []);
    return {
      pending: Array.isArray(pending) ? Number(pending[0] ?? 0) : 0,
      retries: this.retryCount,
      failed: Number(await redis.xLen("echoo:agent-runs:failed")),
    };
  }
}

function toJob(entry: {
  id: string;
  message: Record<string, string>;
}): AgentRunJob {
  return {
    id: entry.id,
    ownerUserId: entry.message.ownerUserId!,
    conversationId: entry.message.conversationId!,
    kind: entry.message.kind as AgentRunJob["kind"],
    ...(entry.message.runId ? { runId: entry.message.runId } : {}),
    attempts: Number(entry.message.attempts || 0),
    trigger: entry.message.trigger as AgentRunJob["trigger"],
    ...(entry.message.debugInstruction
      ? { debugInstruction: entry.message.debugInstruction }
      : {}),
    ...(entry.message.assistantMessageId
      ? { assistantMessageId: entry.message.assistantMessageId }
      : {}),
    ...(entry.message.wakeupToken
      ? { wakeupToken: entry.message.wakeupToken }
      : {}),
    ...(entry.message.passiveStage
      ? {
          passiveStage: Number(
            entry.message.passiveStage,
          ) as AgentRunJob["passiveStage"],
        }
      : {}),
  };
}

function decodeAutoClaim(value: unknown) {
  const entries =
    Array.isArray(value) && Array.isArray(value[1]) ? value[1] : [];
  return entries.flatMap(
    (raw): Array<{ id: string; message: Record<string, string> }> => {
      if (
        !Array.isArray(raw) ||
        typeof raw[0] !== "string" ||
        !Array.isArray(raw[1])
      )
        return [];
      const message: Record<string, string> = {};
      for (let index = 0; index < raw[1].length; index += 2)
        message[String(raw[1][index])] = String(raw[1][index + 1] ?? "");
      return [{ id: raw[0], message }];
    },
  );
}

function retryDelay(attempt: number) {
  const base = [1_000, 5_000, 30_000][attempt] ?? 30_000;
  return base + Math.floor(Math.random() * Math.max(100, base * 0.2));
}

async function renewLock(
  redis: Awaited<ReturnType<typeof getRedis>>,
  key: string,
  token: string,
) {
  if ((await redis.get(key)) === token) await redis.pExpire(key, 10 * 60_000);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
