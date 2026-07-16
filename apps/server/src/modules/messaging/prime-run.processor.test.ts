import assert from "node:assert/strict";
import test from "node:test";
import { PrimeFigureRuntimeService } from "../agents/kinds/prime-figure/prime-figure-runtime.service.js";
import { AppPushService } from "../realtime/delivery.service.js";
import { PrimeRunProcessor } from "./prime-run.processor.js";

interface ActivityPayload {
  type: "conversation.agent_activity";
  conversationId: string;
  active: boolean;
  updatedAt: number;
  expiresAt?: number;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createProcessor(requestDecision: () => Promise<unknown>) {
  const events: ActivityPayload[] = [];
  const runtime = { requestDecision } as unknown as PrimeFigureRuntimeService;
  const appPush = {
    pushToUser: (_userId: string, payload: unknown) => {
      events.push(payload as ActivityPayload);
    },
  } as unknown as AppPushService;
  return { processor: new PrimeRunProcessor(runtime, appPush), events };
}

const job = {
  ownerUserId: "user_1",
  conversationId: "conversation_1",
  kind: "prime-figure" as const,
};

test("keeps prime figure activity active until the whole turn completes", async () => {
  const decision = deferred<null>();
  const { processor, events } = createProcessor(() => decision.promise);

  const processing = processor.process(job);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.active, true);

  decision.resolve(null);
  await processing;

  assert.deepEqual(
    events.map((event) => event.active),
    [true, false],
  );
});

test("clears prime figure activity when the turn fails", async () => {
  const failure = new Error("decision failed");
  const { processor, events } = createProcessor(() => Promise.reject(failure));

  await assert.rejects(processor.process(job), failure);
  assert.deepEqual(
    events.map((event) => event.active),
    [true, false],
  );
});
