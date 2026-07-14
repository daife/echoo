import type { SyncTask } from "@echoo/shared";

export function createMarkReadTask(
  messageId: string,
  readAt: number,
): SyncTask {
  return {
    id: crypto.randomUUID(),
    type: "mark_message_read",
    payload: { messageId, readAt },
    createdAt: Date.now(),
    retryCount: 0,
  };
}
