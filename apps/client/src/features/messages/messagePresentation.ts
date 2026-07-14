import type { Agent, LocalMessage } from "@echoo/shared";

const FIVE_MINUTES_MS = 5 * 60_000;
const SENTENCE_ENDINGS = new Set(["。", "．", ".", "!", "！", "?", "？", "…"]);
const PRIME_PRESENCE_PHASE_DURATION_MS = {
  typing: [1_800, 4_200],
  online: [900, 2_100],
} as const;

export type PrimePresencePhase = keyof typeof PRIME_PRESENCE_PHASE_DURATION_MS;

export function parsePrimeFigureHintCommand(value: string) {
  const match = /^\/hint(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? (match[1]?.trim() ?? "") : null;
}

export function getConversationPresenceLabel(input: {
  agentTypeLabel: string;
  isAgentActive: boolean;
  isAgentMuted: boolean;
}) {
  if (input.isAgentMuted) return "对方已开启勿扰";
  if (input.isAgentActive) return "对方输入中…";
  return `${input.agentTypeLabel}，当前在线`;
}

export function getPrimePresencePhaseDuration(
  phase: PrimePresencePhase,
  randomValue = Math.random(),
) {
  const [minimum, maximum] = PRIME_PRESENCE_PHASE_DURATION_MS[phase];
  const normalizedRandomValue = Math.min(Math.max(randomValue, 0), 1);
  return Math.round(minimum + (maximum - minimum) * normalizedRandomValue);
}

export function isVisibleConversationMessage(message: LocalMessage) {
  if (message.contentType === "image" || message.contentType === "voice") {
    if (
      message.contentType === "voice" &&
      message.metadata?.audioStreaming === true
    )
      return true;
    return Boolean(message.content.mediaUrl);
  }
  if (message.role === "assistant" && message.status === "pending") {
    return Boolean(message.content.text?.trim());
  }
  return Boolean(message.content.text?.trim());
}

export function getPrimeRuntimeErrorText(message: LocalMessage) {
  if (
    message.role !== "system" ||
    message.contentType !== "system" ||
    message.metadata?.kind !== "prime_runtime_error"
  )
    return null;
  return message.content.text?.trim() || null;
}

export function getOutgoingDeliveryState(
  message: LocalMessage,
): "sending" | "failed" | undefined {
  if (message.role !== "user") return undefined;
  if (message.syncStatus === "pending") return "sending";
  if (message.status === "failed") return "failed";
  return undefined;
}

export function shouldShowFigurePendingIndicator(
  message: LocalMessage,
  agentType: Agent["type"],
) {
  return (
    agentType !== "prime-figure" &&
    message.role === "assistant" &&
    message.status === "pending"
  );
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

export function splitFigureReply(value: string) {
  const segments: string[] = [];
  let current = "";
  const chars = Array.from(value);
  const flush = () => {
    const text = current.trim();
    if (text) segments.push(text);
    current = "";
  };

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char === "\r") continue;
    if (char === "\n") {
      flush();
      continue;
    }
    current += char;
    if (!SENTENCE_ENDINGS.has(char)) continue;
    if (
      char === "." &&
      /\d/.test(chars[index - 1] ?? "") &&
      /\d/.test(chars[index + 1] ?? "")
    )
      continue;
    while (SENTENCE_ENDINGS.has(chars[index + 1] ?? "")) {
      index += 1;
      current += chars[index];
    }
    flush();
  }
  flush();
  return segments;
}

export interface ParentheticalTextRun {
  text: string;
  muted: boolean;
}

export function tokenizeParentheticalText(
  value: string,
): ParentheticalTextRun[] {
  const runs: ParentheticalTextRun[] = [];
  let depth = 0;
  for (const char of Array.from(value)) {
    const opening = char === "(" || char === "（";
    const closing = char === ")" || char === "）";
    const muted = depth > 0 || opening || (closing && depth > 0);
    const last = runs.at(-1);
    if (last?.muted === muted) last.text += char;
    else runs.push({ text: char, muted });
    if (opening) depth += 1;
    else if (closing && depth > 0) depth -= 1;
  }
  return runs;
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

export function shouldShowTimelineItemTime(
  items: ReadonlyArray<{
    createdAt: number;
    kind?: string;
    isSourceStart?: boolean;
  }>,
  index: number,
) {
  const item = items[index];
  if (
    !item ||
    item.createdAt <= 0 ||
    item.isSourceStart === false ||
    isTimelineNotice(item)
  )
    return false;

  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previous = items[previousIndex];
    if (
      !previous ||
      previous.isSourceStart === false ||
      isTimelineNotice(previous)
    )
      continue;
    return shouldShowMessageTime(item.createdAt, previous.createdAt);
  }
  return true;
}

function isTimelineNotice(item: { kind?: string }) {
  return item.kind === "memory-summary" || item.kind === "runtime-error";
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
