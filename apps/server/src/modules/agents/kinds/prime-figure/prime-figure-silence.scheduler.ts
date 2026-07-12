import { AgentRunQueue } from "../../../../infra/redis/run-queue.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";

export class PrimeFigureSilenceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly runQueue = new AgentRunQueue(),
    private readonly appPush = new AppPushService(),
  ) {}

  start() {
    if (this.timer) return;
    const intervalMs = Math.max(
      Number(process.env.PRIME_SILENCE_POLL_MS ?? 1000),
      250,
    );
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          console.error("Prime Figure silence scheduler failed.", error),
        ),
      intervalMs,
    );
    this.timer.unref();
    void this.tick().catch((error) =>
      console.error("Prime Figure silence scheduler failed.", error),
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.states.claimDueSilences(Date.now());
      for (const item of due) {
        this.appPush.pushToUser(item.ownerUserId, {
          type: "conversation.agent_mute_changed",
          conversationId: item.conversationId,
          muteUntilMs: null,
          updatedAt: Date.now(),
        });
      }
      await Promise.all(
        due
          .filter((item) => item.hadQueuedMessages)
          .map((item) =>
            this.runQueue.enqueue({
              ownerUserId: item.ownerUserId,
              conversationId: item.conversationId,
              kind: "prime-figure",
              trigger: "mute_ended",
            }),
          ),
      );
    } finally {
      this.ticking = false;
    }
  }
}
