import { getRedisSubscriber } from "../../infra/redis/redis.js";
import { publishDurableRealtime } from "../realtime/realtime-event-bus.js";
import {
  CHANGE_EVENT_WAKE_CHANNEL,
  ChangeEventRepository,
} from "./change-event.repository.js";
import { SyncService } from "./sync.service.js";

export class ChangeEventDispatcher {
  private running = false;
  private draining = false;
  private recoveryTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private subscribed = false;

  constructor(
    private readonly events = new ChangeEventRepository(),
    private readonly sync = new SyncService(),
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;
    await this.ensureSubscribed();
    this.recoveryTimer = setInterval(() => {
      void this.ensureSubscribed();
      void this.drain();
    }, 5_000);
    this.recoveryTimer.unref();
    this.pruneTimer = setInterval(
      () => void this.events.prune().catch((error) => console.error("Change event pruning failed.", error)),
      60 * 60_000,
    );
    this.pruneTimer.unref();
    await this.drain();
  }

  stop() {
    this.running = false;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  private async ensureSubscribed() {
    if (!this.running || this.subscribed) return;
    try {
      const subscriber = await getRedisSubscriber();
      await subscriber.subscribe(CHANGE_EVENT_WAKE_CHANNEL, () => void this.drain());
      this.subscribed = true;
    } catch (error) {
      console.error("Change event wake subscription failed; retrying.", error);
    }
  }

  private async drain() {
    if (!this.running || this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const rows = await this.events.listUnpublished();
        if (!rows.length) return;
        for (const row of rows) {
          const change = await this.sync.hydrate(row);
          if (change)
            await publishDurableRealtime(row.owner_user_id, {
              type: "sync.change",
              change,
            });
          await this.events.markPublished(row.seq);
        }
        if (rows.length < 200) return;
      }
    } catch (error) {
      console.error("Change event dispatch failed.", error);
    } finally {
      this.draining = false;
    }
  }
}
