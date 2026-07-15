export interface ConversationScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
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
