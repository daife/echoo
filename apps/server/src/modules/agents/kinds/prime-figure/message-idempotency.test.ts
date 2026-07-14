import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@echoo/shared";
import { MessagingService } from "../../../messaging/messaging.service.js";

const existing: Message = {
  id: "msg_existing",
  clientMessageId: "client_1",
  conversationId: "conversation_1",
  role: "user",
  contentType: "text",
  content: { text: "hello" },
  status: "sent",
  createdAt: 1,
  updatedAt: 1,
};

for (const type of ["slice-figure", "prime-figure"] as const) {
  test(`${type} text retries reuse the client message without duplicate side effects`, async () => {
    let saveCount = 0;
    let enqueueCount = 0;
    const service = new MessagingService(
      {
        async findByClientMessageId() {
          return existing;
        },
        async save() {
          saveCount += 1;
          return existing;
        },
      } as never,
      {
        async findByIdForOwner() {
          return { id: "conversation_1", agentId: "agent_1", type };
        },
      } as never,
      { pushToUser() {} } as never,
      {} as never,
      {} as never,
      {
        async enqueue() {
          enqueueCount += 1;
        },
      } as never,
      {} as never,
    );

    const result = await service.createUserTextMessage({
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      text: "hello",
      clientMessageId: "client_1",
    });

    assert.equal(result?.message.id, existing.id);
    assert.equal(saveCount, 0);
    assert.equal(enqueueCount, 0);
  });
}
