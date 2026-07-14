import assert from "node:assert/strict";
import test from "node:test";
import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";
import { PrimeRuntimeFailureNotifier } from "./prime-runtime-failure-notifier.js";

test("persists and publishes a Prime runtime failure as a system message", async () => {
  const saved: Array<Record<string, unknown>> = [];
  const pushed: Array<{ userId: string; payload: Record<string, unknown> }> =
    [];
  const notifier = new PrimeRuntimeFailureNotifier(
    {
      async save(input: Record<string, unknown>) {
        saved.push(input);
        const { ownerUserId: _ownerUserId, ...message } = input;
        return { ...message, sequence: 42 };
      },
    } as never,
    {
      pushToUser(userId: string, payload: Record<string, unknown>) {
        pushed.push({ userId, payload });
      },
    } as never,
  );

  await notifier.notify({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    trigger: "end_user_message",
    errorMessage: "openrouter API key is not configured.",
    now: 1234,
  });

  assert.equal(saved.length, 1);
  assert.match(String(saved[0]?.id), /^msg_/);
  assert.deepEqual(saved[0], {
    ownerUserId: "user_1",
    id: saved[0]?.id,
    conversationId: "conversation_1",
    role: "system",
    contentType: "system",
    content: { text: "openrouter API key is not configured." },
    status: "delivered",
    metadata: {
      kind: "prime_runtime_error",
      actionType: "prime_runtime",
      trigger: "end_user_message",
    },
    createdAt: 1234,
    updatedAt: 1234,
  });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]?.userId, "user_1");
  assert.equal(pushed[0]?.payload.type, "message.created");
  assert.deepEqual(
    (pushed[0]?.payload.message as { metadata?: unknown }).metadata,
    saved[0]?.metadata,
  );
});

test("swallows notification persistence failures", async () => {
  const originalConsoleError = console.error;
  const errors: unknown[] = [];
  console.error = (...args: unknown[]) => errors.push(...args);
  try {
    const notifier = new PrimeRuntimeFailureNotifier(
      {
        async save() {
          throw new Error("database unavailable");
        },
      } as never,
      {
        pushToUser() {
          assert.fail("a message that was not saved must not be pushed");
        },
      } as never,
    );

    await notifier.notify({
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      trigger: "end_user_message",
      errorMessage: "runtime failed",
      now: 1234,
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /database unavailable/);
});

test("the outer runtime failure path emits one conversation notification", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const runtime = new PrimeFigureRuntimeService(
    {
      async findByConversation() {
        return { id: "agent_1", type: "prime-figure" };
      },
    } as never,
    {
      async findByAgent() {
        return { variables: {}, memories: [], updatedAt: 1 };
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async save(input: Record<string, unknown>) {
        logs.push(input);
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async resolveConversationConfig() {
        return { config: { messageCoalesceMs: 0 } };
      },
    } as never,
    {} as never,
    {} as never,
    {
      async notify(input: Record<string, unknown>) {
        notifications.push(input);
      },
    } as never,
  );
  (
    runtime as unknown as {
      createDecisionOnce(): Promise<never>;
    }
  ).createDecisionOnce = async () => {
    throw new Error("nested decision failure");
  };

  const result = await runtime.requestDecision({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
  });

  assert.equal(result, null);
  assert.equal(logs.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.errorMessage, "nested decision failure");
});
