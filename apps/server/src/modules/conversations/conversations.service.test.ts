import assert from "node:assert/strict";
import test from "node:test";
import { ConversationsService } from "./conversations.service.js";

test("marking a conversation read is idempotent at the service boundary", async () => {
  let unreadCount = 2;
  let calls = 0;
  const service = new ConversationsService({
    markRead: async (_ownerUserId: string, conversationId: string) => {
      calls += 1;
      unreadCount = 0;
      return {
        id: conversationId,
        title: "小霁",
        type: "slice-figure",
        unreadCount,
        createdAt: 1,
        updatedAt: 2,
      };
    },
  } as never);

  const first = await service.markRead("user_1", "conversation_1");
  const second = await service.markRead("user_1", "conversation_1");
  assert.equal(first?.unreadCount, 0);
  assert.equal(second?.unreadCount, 0);
  assert.equal(calls, 2);
});
