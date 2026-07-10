import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";

export class PrimeFigureSilenceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly states = new PrimeFigureStateRepository(),
    private readonly runtime = new PrimeFigureRuntimeService(),
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
      const due = this.states.claimDueSilences(Date.now());
      await Promise.all(
        due
          .filter((item) => item.hadQueuedMessages)
          .map((item) =>
            this.runtime.requestDecision({
              ownerUserId: item.ownerUserId,
              conversationId: item.conversationId,
              trigger: "silence_ended",
            }),
          ),
      );
    } finally {
      this.ticking = false;
    }
  }
}
