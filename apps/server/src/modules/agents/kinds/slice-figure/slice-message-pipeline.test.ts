import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@echoo/shared";
import { SliceReplyProcessor } from "../../../messaging/slice-reply.processor.js";

const pending: Message = {
  id: "msg_assistant",
  conversationId: "conversation_1",
  role: "assistant",
  contentType: "text",
  content: { text: "" },
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
};

test("slice reply pipeline preserves delta, completion and summary ordering", async () => {
  const events: Array<Record<string, unknown>> = [];
  const saved: Message[] = [];
  const processor = createProcessor({
    events,
    saved,
    async createStreamingReply(_input, onDelta) {
      onDelta({ text: "你" });
      onDelta({ text: "好" });
      return { text: "你好", providerId: "test", model: "model" };
    },
    async createPendingMemorySummaries() {
      return [
        {
          ...pending,
          id: "msg_summary",
          role: "system" as const,
          contentType: "system" as const,
          content: { text: "summary" },
          status: "delivered" as const,
        },
      ];
    },
  });

  await processor.process({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    kind: "slice-figure",
    assistantMessageId: pending.id,
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "message.delta",
      "message.delta",
      "message.completed",
      "message.completed",
    ],
  );
  assert.equal(saved.at(-1)?.content.text, "你好");
  assert.equal(saved.at(-1)?.status, "delivered");
});

test("slice summary failure queues an isolated retry after reply completion", async (t) => {
  const events: Array<Record<string, unknown>> = [];
  const queued: Array<Record<string, unknown>> = [];
  const processor = createProcessor({
    events,
    queued,
    async createStreamingReply(_input, onDelta) {
      onDelta({ text: "ok" });
      return { text: "ok", providerId: "test", model: "model" };
    },
    async createPendingMemorySummaries() {
      throw new Error("summary unavailable");
    },
  });

  t.mock.method(console, "warn", () => undefined);
  await processor.process({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    kind: "slice-figure",
    assistantMessageId: pending.id,
  });

  assert.equal(events.at(-1)?.type, "message.completed");
  assert.deepEqual(queued, [
    {
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      kind: "slice-figure",
      trigger: "memory_summary",
    },
  ]);
});

function createProcessor(input: {
  events: Array<Record<string, unknown>>;
  saved?: Message[];
  queued?: Array<Record<string, unknown>>;
  createStreamingReply: (
    input: unknown,
    onDelta: (delta: { text: string }) => void,
  ) => Promise<{ text: string; providerId: string; model: string }>;
  createPendingMemorySummaries: () => Promise<Message[]>;
}) {
  const repository = {
    async findByIdInConversation() {
      return pending;
    },
    async updateCachedLive() {},
    async save(message: Message & { ownerUserId: string }) {
      const { ownerUserId: _ownerUserId, ...saved } = message;
      input.saved?.push(saved);
      return saved;
    },
  };
  return new SliceReplyProcessor(
    repository as never,
    { async updatePreview() {} } as never,
    {
      pushToUser(_userId: string, event: Record<string, unknown>) {
        input.events.push(event);
      },
    } as never,
    {
      createStreamingReply: input.createStreamingReply,
      createPendingMemorySummaries: input.createPendingMemorySummaries,
    } as never,
    {
      async enqueue(job: Record<string, unknown>) {
        input.queued?.push(job);
      },
    } as never,
  );
}
