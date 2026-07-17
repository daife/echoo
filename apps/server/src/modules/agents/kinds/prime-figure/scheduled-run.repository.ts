import type { PrimeFigureState } from "@echoo/shared";
import type { PoolConnection } from "mysql2/promise";
import { execute } from "../../../../infra/database/mysql.js";
import { getRedis } from "../../../../infra/redis/redis.js";

export const SCHEDULE_WAKE_CHANNEL = "echoo:scheduled-runs:wake";

export async function syncScheduledRuns(
  connection: PoolConnection,
  input: {
    ownerUserId: string;
    conversationId: string;
    state: PrimeFigureState | Record<string, unknown>;
    now?: number;
  },
) {
  const state = input.state as PrimeFigureState;
  const now = input.now ?? Date.now();
  const schedules = [
    state.proactiveWakeup
      ? {
          kind: "proactive",
          dueAt: state.proactiveWakeup.lease?.leaseUntilMs ?? state.proactiveWakeup.dueAtMs,
          token: state.proactiveWakeup.token,
          attempts: state.proactiveWakeup.lease?.deliveryAttempts ?? 0,
          payload: {
            interactionAfterSequence: state.proactiveWakeup.interactionAfterSequence,
            interactionInvalidationWindowMinutes:
              state.proactiveWakeup.interactionInvalidationWindowMinutes,
          },
        }
      : null,
    state.passiveWakeup
      ? {
          kind: "passive",
          dueAt: state.passiveWakeup.lease?.leaseUntilMs ?? state.passiveWakeup.dueAtMs,
          token: state.passiveWakeup.token,
          attempts: state.passiveWakeup.lease?.deliveryAttempts ?? 0,
          payload: {
            stage: state.passiveWakeup.stage,
            baselineEndUserSequence: state.passiveWakeup.baselineEndUserSequence,
          },
        }
      : null,
    state.silenceUntilMs
      ? {
          kind: "mute_ended",
          dueAt: state.silenceUntilMs,
          token: null,
          attempts: 0,
          payload: null,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  await execute(
    "DELETE FROM scheduled_runs WHERE conversation_id = ?",
    [input.conversationId],
    connection,
  );
  for (const schedule of schedules)
    await execute(
      `INSERT INTO scheduled_runs
       (id, owner_user_id, conversation_id, kind, due_at, lease_until, attempts,
        token, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        `${input.conversationId}:${schedule.kind}`,
        input.ownerUserId,
        input.conversationId,
        schedule.kind,
        schedule.dueAt,
        schedule.attempts,
        schedule.token,
        schedule.payload ? JSON.stringify(schedule.payload) : null,
        now,
        now,
      ],
      connection,
    );
  const wakeTimer = setTimeout(() => {
    void getRedis()
      .then((redis) => redis.publish(SCHEDULE_WAKE_CHANNEL, input.conversationId))
      .catch(() => undefined);
  }, 25);
  wakeTimer.unref();
}
