import { AgentRunQueue } from "../../../../infra/redis/run-queue.js";
import { environment } from "../../../../infra/config/environment.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import {
  getRedis,
  getRedisSubscriber,
} from "../../../../infra/redis/redis.js";
import { randomUUID } from "node:crypto";
import { SCHEDULE_WAKE_CHANNEL } from "./scheduled-run.repository.js";

export class PrimeFigureWakeupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;

  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly runQueue = new AgentRunQueue(),
    private readonly appPush = new AppPushService(),
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;
    await getRedisSubscriber()
      .then((subscriber) =>
        subscriber.subscribe(SCHEDULE_WAKE_CHANNEL, () => this.schedule(0)),
      )
      .catch((error) =>
        console.error("Scheduler wake subscription unavailable; using timed recovery.", error),
      );
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async metrics(now = Date.now()) {
    const nextDueAt = await this.states.nextDueAt();
    return {
      nextDueAt,
      dueLagMs: nextDueAt === null ? 0 : Math.max(0, now - nextDueAt),
    };
  }

  private async tick() {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      const redis = await getRedis();
      const token = randomUUID();
      const lock = await redis.set("echoo:scheduler:prime-wakeup", token, {
        NX: true,
        PX: 5_000,
      });
      if (!lock) {
        this.schedule(1_000);
        return;
      }
      const due = await this.states.claimDueWakeups(Date.now());
      for (const item of due) {
        if (item.muteEnded)
          this.appPush.pushToUser(item.ownerUserId, {
            type: "conversation.agent_mute_changed",
            conversationId: item.conversationId,
            muteUntilMs: null,
            updatedAt: Date.now(),
          });
      }
      await Promise.all(
        due
          .filter((item) => item.trigger)
          .map((item) =>
            this.runQueue.enqueue({
              ownerUserId: item.ownerUserId,
              conversationId: item.conversationId,
              kind: "prime-figure",
              trigger: item.trigger!,
              wakeupToken: item.wakeupToken,
              passiveStage: item.passiveStage,
            }),
          ),
      );
      const nextDueAt = await this.states.nextDueAt();
      const delay =
        nextDueAt === null
          ? 30_000
          : Math.min(Math.max(nextDueAt - Date.now(), 250), 30_000);
      this.schedule(delay);
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: ["echoo:scheduler:prime-wakeup"], arguments: [token] },
      );
    } finally {
      this.ticking = false;
    }
  }

  private schedule(delay: number) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        void this.tick().catch((error) => {
          console.error("Prime Figure wakeup scheduler failed.", error);
          this.schedule(Math.max(environment.primeSilencePollMs, 1_000));
        }),
      delay,
    );
    this.timer.unref();
  }
}
