import type { AgentRunJob } from "../../infra/redis/run-queue.js";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { AppPushService } from "../realtime/delivery.service.js";

const ACTIVITY_HEARTBEAT_MS = 15_000;
const ACTIVITY_LEASE_MS = 45_000;

export class PrimeRunProcessor {
  private readonly activityUpdatedAt = new Map<string, number>();

  constructor(
    private readonly runtime = new PrimeFigureRuntimeService(),
    private readonly appPush = new AppPushService(),
  ) {}

  async process(job: AgentRunJob) {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let active = false;
    const publishActiveLease = () =>
      this.publishActivity({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        active: true,
        expiresAt: Date.now() + ACTIVITY_LEASE_MS,
      });
    const setTurnActivity = (nextActive: boolean) => {
      if (nextActive) {
        if (active) return;
        active = true;
        publishActiveLease();
        heartbeat = setInterval(publishActiveLease, ACTIVITY_HEARTBEAT_MS);
        heartbeat.unref?.();
        return;
      }
      if (!active) return;
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      this.publishActivity({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        active: false,
      });
    };
    setTurnActivity(true);
    try {
      await this.runtime.requestDecision({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        trigger: job.trigger === "memory_summary" ? undefined : job.trigger,
        debugInstruction: job.debugInstruction,
        wakeupToken: job.wakeupToken,
        passiveStage: job.passiveStage,
      });
    } finally {
      setTurnActivity(false);
    }
  }

  publishActivity(input: {
    ownerUserId: string;
    conversationId: string;
    active: boolean;
    expiresAt?: number;
  }) {
    const updatedAt = Math.max(
      Date.now(),
      (this.activityUpdatedAt.get(input.conversationId) ?? 0) + 1,
    );
    this.activityUpdatedAt.set(input.conversationId, updatedAt);
    this.appPush.pushToUser(input.ownerUserId, {
      type: "conversation.agent_activity",
      conversationId: input.conversationId,
      active: input.active,
      updatedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
  }
}
