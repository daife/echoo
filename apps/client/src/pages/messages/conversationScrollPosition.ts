export interface ConversationScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export type ConversationScrollDirection = "up" | "down" | null;

export function shouldAdjustForConversationItemResize(input: {
  itemEnd: number;
  scrollTop: number;
  direction: ConversationScrollDirection;
}) {
  return input.direction !== "up" && input.itemEnd <= input.scrollTop;
}

export const LATEST_MESSAGE_DISTANCE_THRESHOLD = 120;

export function isAwayFromLatestMessage(
  metrics: ConversationScrollMetrics,
  threshold = LATEST_MESSAGE_DISTANCE_THRESHOLD,
) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > threshold
  );
}
