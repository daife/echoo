import { environment } from "../../../../infra/config/environment.js";
import { PrimeWorldRepository } from "./prime-world.repository.js";

export class PrimeWorldRetentionScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly worlds = new PrimeWorldRepository()) {}

  async start() {
    await this.runOnce();
    this.timer = setInterval(
      () => void this.runOnce(),
      environment.primeWorldCleanupIntervalMs,
    );
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = Date.now()) {
    if (this.running) return { compacted: 0, deleted: 0 };
    this.running = true;
    try {
      return await this.worlds.compactAndPruneRuns({
        compactBefore: now - environment.primeWorldFullRunRetentionMs,
        deleteBefore: now - environment.primeWorldRunRetentionMs,
      });
    } finally {
      this.running = false;
    }
  }
}
