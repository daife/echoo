import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { execute, withTransaction } from "../../infra/database/mysql.js";
import { updateConversationPreview } from "./conversation.repository.js";

const connection = {};

test("publishes a conversation change when the preview changes without increasing unread", async () => {
  const append = mock.fn(async () => 1);
  const run = mock.fn(async () => ({ affectedRows: 1 }));
  const transaction = async (
    callback: (transactionConnection: never) => Promise<unknown>,
  ) => callback(connection as never);

  await updateConversationPreview(
    { append } as never,
    {
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      preview: "sent by the user",
      updatedAt: 123,
      unreadIncrement: 0,
    },
    transaction as typeof withTransaction,
    run as unknown as typeof execute,
  );

  assert.equal(run.mock.callCount(), 1);
  assert.deepEqual(append.mock.calls[0]?.arguments, [
    {
      ownerUserId: "user_1",
      entityType: "conversation",
      entityId: "conversation_1",
      conversationId: "conversation_1",
      operation: "upsert",
      createdAt: 123,
    },
    connection,
  ]);
});
