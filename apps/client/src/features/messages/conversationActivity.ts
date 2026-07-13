import type { LocalMessage } from "@echoo/shared";

type ActivityMessage = Pick<LocalMessage, "role" | "status">;

export function activityAfterMessageCreated(
  current: boolean,
  message: ActivityMessage,
) {
  if (message.role === "user") return false;
  if (message.role === "assistant" && message.status === "pending") return true;
  return current;
}

export function activityAfterMessageCompleted(
  current: boolean,
  message: ActivityMessage,
) {
  if (message.role === "assistant" && message.status === "failed") return false;
  return current;
}
