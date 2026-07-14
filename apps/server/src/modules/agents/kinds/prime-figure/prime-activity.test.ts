import assert from "node:assert/strict";
import test from "node:test";
import { MessagingService } from "../../../messaging/messaging.service.js";

test("prime activity starts only when the runtime enters its model phase", async () => {
  const events: Array<Record<string, unknown>> = [];
  const runtime = {
    async requestDecision(input: {
      onModelActivityChange?: (active: boolean) => void;
    }) {
      assert.equal(events.length, 0);
      input.onModelActivityChange?.(true);
      assert.equal(events.at(-1)?.active, true);
      input.onModelActivityChange?.(false);
      return null;
    },
  };
  const service = createService(runtime, events);
  const startedAt = Date.now();

  await service.processQueuedRun({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    kind: "prime-figure",
  });

  assert.deepEqual(
    events.map((event) => event.active),
    [true, false],
  );
  assert.ok(Number(events[0]?.expiresAt) >= startedAt + 44_000);
  assert.equal(events[1]?.expiresAt, undefined);
});

test("prime activity is not published when no model request is needed", async () => {
  const events: Array<Record<string, unknown>> = [];
  const service = createService({ requestDecision: async () => null }, events);

  await service.processQueuedRun({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    kind: "prime-figure",
  });

  assert.deepEqual(events, []);
});

test("prime activity always becomes inactive when the model phase fails", async () => {
  const events: Array<Record<string, unknown>> = [];
  const service = createService(
    {
      async requestDecision(input: {
        onModelActivityChange?: (active: boolean) => void;
      }) {
        input.onModelActivityChange?.(true);
        throw new Error("model failed");
      },
    },
    events,
  );

  await assert.rejects(() =>
    service.processQueuedRun({
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      kind: "prime-figure",
    }),
  );
  assert.deepEqual(
    events.map((event) => event.active),
    [true, false],
  );
});

function createService(
  runtime: { requestDecision(input: unknown): Promise<unknown> },
  events: Array<Record<string, unknown>>,
) {
  return new MessagingService(
    {} as never,
    {} as never,
    {
      pushToUser(_userId: string, event: Record<string, unknown>) {
        events.push(event);
      },
    } as never,
    {} as never,
    runtime as never,
    {} as never,
    {} as never,
  );
}
