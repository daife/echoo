import type { LocalMessage } from "@echoo/shared";

const FIVE_MINUTES_MS = 5 * 60_000;

export function parsePrimeFigureHintCommand(value: string) {
  const match = /^\/hint(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? (match[1]?.trim() ?? "") : null;
}

export function isVisibleConversationMessage(
  message: LocalMessage,
  agentType: "slice-figure" | "prime-figure" | string,
) {
  if (message.contentType === "image" || message.contentType === "voice") {
    if (
      message.contentType === "voice" &&
      message.metadata?.audioStreaming === true
    )
      return true;
    return message.status !== "pending" && Boolean(message.content.mediaUrl);
  }
  if (message.role === "assistant" && message.status === "pending") {
    return Boolean(message.content.text?.trim());
  }
  return Boolean(message.content.text?.trim());
}

export function sanitizeVoiceTranscript(value: string) {
  let clean = value;
  let previous = "";
  while (clean !== previous) {
    previous = clean;
    clean = clean.replace(/\[[^\[\]]*\]|【[^【】]*】/g, " ");
  }
  return clean.replace(/\s+/g, " ").trim();
}

export function shouldShowMessageTime(
  timestamp: number,
  previousTimestamp?: number,
) {
  return (
    previousTimestamp === undefined ||
    timestamp - previousTimestamp >= FIVE_MINUTES_MS
  );
}

export function formatConversationTime(timestamp: number, now = Date.now()) {
  const value = new Date(timestamp);
  const current = new Date(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
  const startOfToday = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ).getTime();
  const startOfValue = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
  const dayDifference = Math.round((startOfToday - startOfValue) / 86_400_000);
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (dayDifference > 1 && dayDifference < 7) {
    return `${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(value)} ${time}`;
  }
  if (value.getFullYear() === current.getFullYear()) {
    return `${value.getMonth() + 1}月${value.getDate()}日 ${time}`;
  }
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 ${time}`;
}
