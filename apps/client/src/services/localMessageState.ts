import type { LocalMessage, Message } from "@echoo/shared";

export function createPendingTextMessage(input: {
  conversationId: string;
  text: string;
  clientMessageId?: string;
  now?: number;
}): LocalMessage {
  const clientMessageId =
    input.clientMessageId ?? `client_${crypto.randomUUID()}`;
  const now = input.now ?? Date.now();

  return {
    id: clientMessageId,
    clientMessageId,
    conversationId: input.conversationId,
    role: "user",
    contentType: "text",
    content: { text: input.text },
    status: "pending",
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
}

export function createPendingMediaMessage(input: {
  conversationId: string;
  contentType: "image" | "voice" | "video";
  mediaUrl: string;
  fileName: string;
  durationSeconds?: number;
  clientMessageId?: string;
  now?: number;
}): LocalMessage {
  const clientMessageId =
    input.clientMessageId ?? `client_${crypto.randomUUID()}`;
  const now = input.now ?? Date.now();
  return {
    id: clientMessageId,
    clientMessageId,
    conversationId: input.conversationId,
    role: "user",
    contentType: input.contentType,
    content: {
      mediaUrl: input.mediaUrl,
      fileName: input.fileName,
    },
    status: "pending",
    ...(input.contentType === "voice" && input.durationSeconds !== undefined
      ? {
          metadata: {
            mediaIntent: {
              status: "ready",
              durationSeconds: input.durationSeconds,
            },
          },
        }
      : {}),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
}

export function mergeLocalMessage(
  messages: LocalMessage[],
  message: LocalMessage,
) {
  return [...messages.filter((item) => item.id !== message.id), message].sort(
    compareTimelineMessages,
  );
}

export function compareTimelineMessages(left: Message, right: Message) {
  const leftOrder = getLogicalSequence(left);
  const rightOrder = getLogicalSequence(right);
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder)
    return leftOrder - rightOrder;
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt - right.createdAt;
}

function getLogicalSequence(message: Message) {
  if (message.metadata?.kind === "memory_summary") {
    const covered = message.metadata.coveredThroughSequence;
    if (typeof covered === "number" && Number.isFinite(covered))
      return covered + 0.5;
  }
  return typeof message.sequence === "number" ? message.sequence : null;
}

export function mergeIncomingMessage(
  messages: LocalMessage[],
  message: LocalMessage,
) {
  const existing = messages.find((item) => isSameLogicalMessage(item, message));
  const incomingText = message.content.text ?? "";
  const existingText = existing?.content.text ?? "";
  const messagesWithoutExisting = messages.filter(
    (item) => !isSameLogicalMessage(item, message),
  );

  if (
    existing &&
    message.role === "assistant" &&
    message.status === "pending" &&
    !incomingText &&
    existingText
  ) {
    return mergeLocalMessage(messagesWithoutExisting, {
      ...message,
      content: {
        ...message.content,
        text: existingText,
      },
      updatedAt: Math.max(existing.updatedAt, message.updatedAt),
    });
  }

  return mergeLocalMessage(messagesWithoutExisting, message);
}

export function appendMessageDelta(
  messages: LocalMessage[],
  messageId: string,
  delta: string,
  updatedAt: number,
) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;

    return {
      ...message,
      content: {
        ...message.content,
        text: `${message.content.text ?? ""}${delta}`,
      },
      status: "pending" as const,
      updatedAt,
    };
  });
}

export function mergeSentMessageResult(
  messages: LocalMessage[],
  clientMessageId: string,
  result: { message: Message; assistantMessage?: Message },
) {
  const withUserMessage = mergeLocalMessage(
    messages.filter((message) => message.id !== clientMessageId),
    {
      ...result.message,
      syncStatus: "synced",
    },
  );

  return result.assistantMessage
    ? mergeIncomingMessage(withUserMessage, {
        ...result.assistantMessage,
        syncStatus: "synced",
      })
    : withUserMessage;
}

export function markLocalMessageFailed(
  messages: LocalMessage[],
  messageId: string,
  updatedAt = Date.now(),
) {
  return messages.map((message) =>
    message.id === messageId || message.clientMessageId === messageId
      ? {
          ...message,
          status: "failed" as const,
          syncStatus: "failed" as const,
          updatedAt,
        }
      : message,
  );
}

export function markLocalMessageSending(
  message: LocalMessage,
  updatedAt = Date.now(),
): LocalMessage {
  const clientMessageId = message.clientMessageId ?? message.id;
  return {
    ...message,
    id: clientMessageId,
    clientMessageId,
    status: "pending",
    syncStatus: "pending",
    updatedAt,
  };
}

function isSameLogicalMessage(left: LocalMessage, right: LocalMessage) {
  if (left.id === right.id) return true;
  if (!left.clientMessageId || !right.clientMessageId) return false;
  return left.clientMessageId === right.clientMessageId;
}
