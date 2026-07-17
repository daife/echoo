import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeEventRow } from "./change-event.repository.js";
import { SyncService, coalesceRows } from "./sync.service.js";

function row(
  seq: number,
  entityId: string,
  operation: "upsert" | "delete" = "upsert",
): ChangeEventRow {
  return {
    seq,
    owner_user_id: "user_1",
    entity_type: "message",
    entity_id: entityId,
    conversation_id: "conv_1",
    operation,
    published_at: null,
    created_at: seq,
  } as ChangeEventRow;
}

test("coalesces repeated entity changes to their latest cursor and preserves ordering", () => {
  assert.deepEqual(
    coalesceRows([row(1, "a"), row(2, "b"), row(3, "a", "delete")]).map(
      ({ seq, entity_id, operation }) => [seq, entity_id, operation],
    ),
    [
      [2, "b", "upsert"],
      [3, "a", "delete"],
    ],
  );
});

test("returns resetRequired when a retained event gap makes the cursor stale", async () => {
  const events = {
    head: async () => 30,
    oldest: async () => 10,
    listAfter: async () => {
      throw new Error("must not read an expired cursor");
    },
  };
  const service = new SyncService(events as never);
  const page = await service.list("user_1", 4);
  assert.equal(page.resetRequired, true);
  assert.equal(page.headCursor, 30);
  assert.deepEqual(page.changes, []);
});

test("hydrates delete events as tombstones without reading the deleted entity", async () => {
  const service = new SyncService();
  assert.deepEqual(await service.hydrate(row(12, "gone", "delete")), {
    cursor: 12,
    entityType: "message",
    entityId: "gone",
    conversationId: "conv_1",
    operation: "delete",
    createdAt: 12,
  });
});
