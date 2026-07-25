import type { PrimeMessage } from "@echoo/shared";

const DIRECT_MEDIA_TYPES = new Set(["image", "video", "voice"]);

export function requiresDirectMediaReply(
  timeline: PrimeMessage[],
  lastHandledEndUserSeq: number,
) {
  const newlyReceivedMessages = timeline.filter(
    (message) =>
      message.sender === "end_user" &&
      (message.sequence ?? 0) > lastHandledEndUserSeq,
  );
  return (
    newlyReceivedMessages.length > 0 &&
    newlyReceivedMessages.every((message) =>
      DIRECT_MEDIA_TYPES.has(message.content.type),
    )
  );
}
