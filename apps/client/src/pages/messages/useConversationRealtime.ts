import type { LocalMessage } from "@echoo/shared";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { MessageRuntime } from "../../runtimes/contracts";
import {
  appendMessageDelta,
  mergeIncomingMessage,
  mergeLocalMessage,
} from "../../services/localMessageState";
import {
  activityAfterMessageCompleted,
  activityAfterMessageCreated,
} from "../../features/messages/conversationActivity";
import {
  getRuntimeErrorText,
  type RuntimeErrorNotice,
} from "../../features/messages/messagePresentation";
import { mediaCache } from "../../services/mediaCache";

interface StreamDisplayBuffer {
  chars: string[];
  cursor: number;
  timerId: number | null;
  charsPerSecond: number;
  lastDeltaAt: number;
  completedMessage?: LocalMessage;
}

export function useConversationRealtime(input: {
  runtime: MessageRuntime;
  conversationId?: string;
  isPrimeFigure: boolean;
  messagesRef: RefObject<LocalMessage[]>;
  setMessages: Dispatch<SetStateAction<LocalMessage[]>>;
  setIsAgentActive: Dispatch<SetStateAction<boolean>>;
  setMuteUntilMs: Dispatch<SetStateAction<number | undefined>>;
  onRuntimeError: (notice: RuntimeErrorNotice) => void;
}) {
  const streamBuffersRef = useRef(new Map<string, StreamDisplayBuffer>());
  const audioChunksRef = useRef(new Map<string, Uint8Array[]>());
  const audioByteCountsRef = useRef(new Map<string, number>());

  const clearStreamBuffers = useCallback(() => {
    streamBuffersRef.current.forEach((buffer) => {
      if (buffer.timerId !== null) window.clearTimeout(buffer.timerId);
    });
    streamBuffersRef.current.clear();
    audioChunksRef.current.clear();
    audioByteCountsRef.current.clear();
  }, []);

  const scheduleStreamDrain = useCallback(
    (messageId: string) => {
      const buffer = streamBuffersRef.current.get(messageId);
      if (!buffer || buffer.timerId !== null) return;

      const drain = () => {
        const currentBuffer = streamBuffersRef.current.get(messageId);
        if (!currentBuffer) return;
        const nextChar = currentBuffer.chars[currentBuffer.cursor];
        if (nextChar) {
          currentBuffer.cursor += 1;
          input.setMessages((current) =>
            appendMessageDelta(current, messageId, nextChar, Date.now()),
          );
        }
        if (currentBuffer.cursor > 256) {
          currentBuffer.chars = currentBuffer.chars.slice(currentBuffer.cursor);
          currentBuffer.cursor = 0;
        }
        if (currentBuffer.cursor >= currentBuffer.chars.length) {
          currentBuffer.timerId = null;
          if (currentBuffer.completedMessage) {
            input.setMessages((current) =>
              mergeLocalMessage(current, currentBuffer.completedMessage!),
            );
            streamBuffersRef.current.delete(messageId);
          }
          return;
        }
        currentBuffer.timerId = window.setTimeout(
          drain,
          getStreamDrainDelay(currentBuffer),
        );
      };

      buffer.timerId = window.setTimeout(drain, getStreamDrainDelay(buffer));
    },
    [input.setMessages],
  );

  const enqueueDisplayDelta = useCallback(
    (messageId: string, delta: string) => {
      if (input.isPrimeFigure) {
        input.setMessages((current) =>
          appendMessageDelta(current, messageId, delta, Date.now()),
        );
        return;
      }
      const now = performance.now();
      const buffer = streamBuffersRef.current.get(messageId) ?? {
        chars: [],
        cursor: 0,
        timerId: null,
        charsPerSecond: 28,
        lastDeltaAt: now,
      };
      const chars = Array.from(delta);
      const elapsedSeconds = Math.max((now - buffer.lastDeltaAt) / 1000, 0.08);
      const observedCharsPerSecond = chars.length / elapsedSeconds;
      buffer.chars.push(...chars);
      buffer.charsPerSecond = clamp(
        buffer.charsPerSecond * 0.7 + observedCharsPerSecond * 0.3,
        14,
        90,
      );
      buffer.lastDeltaAt = now;
      streamBuffersRef.current.set(messageId, buffer);
      scheduleStreamDrain(messageId);
    },
    [input.isPrimeFigure, input.setMessages, scheduleStreamDrain],
  );

  const completeStreamedMessage = useCallback(
    (message: LocalMessage) => {
      const displayed =
        input.messagesRef.current.find((item) => item.id === message.id)
          ?.content.text ?? "";
      const finalText = message.content.text ?? "";
      const buffer = streamBuffersRef.current.get(message.id) ?? {
        chars: [],
        cursor: 0,
        timerId: null,
        charsPerSecond: 32,
        lastDeltaAt: performance.now(),
      };
      const queuedText = buffer.chars.slice(buffer.cursor).join("");
      const displayedAndQueued = `${displayed}${queuedText}`;

      if (finalText.startsWith(displayedAndQueued)) {
        const missingText = finalText.slice(displayedAndQueued.length);
        if (missingText) buffer.chars.push(...Array.from(missingText));
        buffer.completedMessage = message;
        streamBuffersRef.current.set(message.id, buffer);
        scheduleStreamDrain(message.id);
        return;
      }
      if (finalText.startsWith(displayed)) {
        buffer.chars = Array.from(finalText.slice(displayed.length));
        buffer.cursor = 0;
        buffer.completedMessage = message;
        streamBuffersRef.current.set(message.id, buffer);
        scheduleStreamDrain(message.id);
        return;
      }
      input.setMessages((current) => mergeLocalMessage(current, message));
      streamBuffersRef.current.delete(message.id);
    },
    [input.messagesRef, input.setMessages, scheduleStreamDrain],
  );

  useEffect(
    () => () => clearStreamBuffers(),
    [clearStreamBuffers, input.conversationId],
  );

  useEffect(() => {
    const conversationId = input.conversationId;
    if (!conversationId) return;
    const unsubscribers = [
      input.runtime.onSyncChange((change) => {
        if (
          change.entityType !== "message" ||
          change.conversationId !== conversationId
        )
          return;
        if (change.operation === "delete") {
          input.setMessages((current) =>
            current.filter((message) => message.id !== change.entityId),
          );
          return;
        }
        if (change.entity?.entityType === "message") {
          const message = change.entity.value;
          const syncedMessage = { ...message, syncStatus: "synced" as const };
          if (shouldHidePrimePendingPlaceholder(input.isPrimeFigure, message))
            return;
          if (
            shouldBufferCompletedAssistantMessage(
              input.isPrimeFigure,
              message,
            )
          ) {
            completeStreamedMessage(syncedMessage);
            return;
          }
          input.setMessages((current) =>
            mergeIncomingMessage(current, syncedMessage),
          );
        }
      }),
      input.runtime.onMessageCreated((message) => {
        if (message.conversationId !== conversationId) return;
        const runtimeErrorText = getRuntimeErrorText(message);
        if (runtimeErrorText) {
          input.setIsAgentActive(false);
          input.onRuntimeError({ id: message.id, text: runtimeErrorText });
          return;
        }
        if (shouldHidePrimePendingPlaceholder(input.isPrimeFigure, message))
          return;
        input.setIsAgentActive((current) =>
          activityAfterMessageCreated(current, message, !input.isPrimeFigure),
        );
        input.setMessages((current) =>
          mergeIncomingMessage(current, { ...message, syncStatus: "synced" }),
        );
      }),
      input.runtime.onMessageDelta((event) => {
        if (event.conversationId !== conversationId) return;
        const message = input.messagesRef.current.find(
          (item) => item.id === event.messageId,
        );
        if (!shouldDisplayMessageDelta(input.isPrimeFigure, message)) return;
        enqueueDisplayDelta(event.messageId, event.delta);
      }),
      input.runtime.onMessageCompleted((message) => {
        if (message.conversationId !== conversationId) return;
        const runtimeErrorText = getRuntimeErrorText(message);
        if (runtimeErrorText) {
          input.setIsAgentActive(false);
          input.onRuntimeError({ id: message.id, text: runtimeErrorText });
          return;
        }
        input.setIsAgentActive((current) =>
          activityAfterMessageCompleted(current, message),
        );
        if (input.isPrimeFigure) {
          input.setMessages((current) => {
            const existing = current.find((item) => item.id === message.id);
            return mergeLocalMessage(current, {
              ...message,
              metadata: {
                ...existing?.metadata,
                ...message.metadata,
                audioStreaming: false,
              },
              syncStatus: "synced",
            });
          });
          audioChunksRef.current.delete(message.id);
          audioByteCountsRef.current.delete(message.id);
        } else {
          completeStreamedMessage({ ...message, syncStatus: "synced" });
        }
      }),
      input.runtime.onMessageUpdated((message) => {
        if (message.conversationId !== conversationId) return;
        const runtimeErrorText = getRuntimeErrorText(message);
        if (runtimeErrorText) {
          input.onRuntimeError({ id: message.id, text: runtimeErrorText });
          return;
        }
        if (message.conversationId === conversationId)
          input.setMessages((current) =>
            mergeLocalMessage(current, { ...message, syncStatus: "synced" }),
          );
      }),
      input.runtime.onConversationAgentActivity((event) => {
        if (event.conversationId === conversationId)
          input.setIsAgentActive(event.active);
      }),
      input.runtime.onConversationAgentMuteChanged((event) => {
        if (event.conversationId === conversationId)
          input.setMuteUntilMs(
            event.muteUntilMs && event.muteUntilMs > Date.now()
              ? event.muteUntilMs
              : undefined,
          );
      }),
      input.runtime.onMessageAudioStarted((event) => {
        if (event.conversationId !== conversationId) return;
        audioChunksRef.current.set(event.messageId, []);
        audioByteCountsRef.current.set(event.messageId, 0);
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: 0,
        });
      }),
      input.runtime.onMessageAudioChunk((event) => {
        if (event.conversationId !== conversationId) return;
        const chunks = audioChunksRef.current.get(event.messageId) ?? [];
        chunks.push(event.data);
        audioChunksRef.current.set(event.messageId, chunks);
        const byteCount =
          (audioByteCountsRef.current.get(event.messageId) ?? 0) +
          event.data.byteLength;
        audioByteCountsRef.current.set(event.messageId, byteCount);
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: byteCount / 16_000,
        });
      }),
      input.runtime.onMessageAudioCompleted((event) => {
        if (event.conversationId !== conversationId) return;
        const chunks = audioChunksRef.current.get(event.messageId);
        if (event.mediaUrl && chunks?.length)
          void mediaCache.put(
            event.mediaUrl,
            new Blob([concatBytes(chunks)], { type: "audio/mpeg" }),
          );
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: true,
          ...(event.mediaUrl ? { mediaUrl: event.mediaUrl } : {}),
        });
      }),
      input.runtime.onMessageAudioFailed((event) => {
        if (event.conversationId !== conversationId) return;
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: false,
        });
        audioChunksRef.current.delete(event.messageId);
        audioByteCountsRef.current.delete(event.messageId);
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [
    completeStreamedMessage,
    enqueueDisplayDelta,
    input.conversationId,
    input.isPrimeFigure,
    input.onRuntimeError,
    input.runtime,
    input.setIsAgentActive,
    input.setMessages,
    input.setMuteUntilMs,
  ]);

  return { clearStreamBuffers };
}

function getStreamDrainDelay(buffer: StreamDisplayBuffer) {
  const remainingChars = buffer.chars.length - buffer.cursor;
  const backlogBoost =
    remainingChars > 120
      ? 2.1
      : remainingChars > 60
        ? 1.65
        : remainingChars > 24
          ? 1.3
          : 1;
  const charactersPerSecond = clamp(
    buffer.charsPerSecond * backlogBoost,
    12,
    120,
  );
  return clamp(Math.round(1000 / charactersPerSecond), 8, 90);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function shouldHidePrimePendingPlaceholder(
  isPrimeFigure: boolean,
  message: Pick<LocalMessage, "role" | "contentType" | "content" | "status">,
) {
  return (
    isPrimeFigure &&
    message.role === "assistant" &&
    message.contentType !== "voice" &&
    message.status === "pending" &&
    !(message.content.text ?? "").trim()
  );
}

export function shouldDisplayMessageDelta(
  isPrimeFigure: boolean,
  message: Pick<LocalMessage, "contentType"> | undefined,
) {
  return !isPrimeFigure || message?.contentType === "voice";
}

export function shouldBufferCompletedAssistantMessage(
  isPrimeFigure: boolean,
  message: Pick<LocalMessage, "role" | "status">,
) {
  return (
    !isPrimeFigure &&
    message.role === "assistant" &&
    message.status !== "pending"
  );
}

function updateAudioMessage(
  setMessages: Dispatch<SetStateAction<LocalMessage[]>>,
  messageId: string,
  patch: {
    audioStreaming: boolean;
    liveAudioDurationSeconds?: number;
    mediaUrl?: string;
  },
) {
  setMessages((current) =>
    current.map((message) =>
      message.id === messageId
        ? {
            ...message,
            content: {
              ...message.content,
              ...(patch.mediaUrl ? { mediaUrl: patch.mediaUrl } : {}),
            },
            metadata: {
              ...message.metadata,
              audioStreaming: patch.audioStreaming,
              ...(patch.liveAudioDurationSeconds !== undefined
                ? { liveAudioDurationSeconds: patch.liveAudioDurationSeconds }
                : {}),
            },
            updatedAt: Date.now(),
          }
        : message,
    ),
  );
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
