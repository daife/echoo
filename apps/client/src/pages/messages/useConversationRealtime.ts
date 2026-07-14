import { estimateMp3DurationSeconds, type LocalMessage } from "@echoo/shared";
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
}) {
  const streamBuffersRef = useRef(new Map<string, StreamDisplayBuffer>());
  const audioChunksRef = useRef(new Map<string, Uint8Array[]>());

  const clearStreamBuffers = useCallback(() => {
    streamBuffersRef.current.forEach((buffer) => {
      if (buffer.timerId !== null) window.clearTimeout(buffer.timerId);
    });
    streamBuffersRef.current.clear();
    audioChunksRef.current.clear();
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
      input.runtime.onMessageCreated((message) => {
        if (message.conversationId !== conversationId) return;
        input.setIsAgentActive((current) =>
          activityAfterMessageCreated(current, message, !input.isPrimeFigure),
        );
        input.setMessages((current) =>
          mergeIncomingMessage(current, { ...message, syncStatus: "synced" }),
        );
      }),
      input.runtime.onMessageDelta((event) => {
        if (event.conversationId === conversationId)
          enqueueDisplayDelta(event.messageId, event.delta);
      }),
      input.runtime.onMessageCompleted((message) => {
        if (message.conversationId !== conversationId) return;
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
        } else {
          completeStreamedMessage({ ...message, syncStatus: "synced" });
        }
      }),
      input.runtime.onMessageUpdated((message) => {
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
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: 0,
        });
      }),
      input.runtime.onMessageAudioChunk((event) => {
        if (event.conversationId !== conversationId) return;
        const chunks = audioChunksRef.current.get(event.messageId) ?? [];
        chunks.push(decodeBase64(event.dataBase64));
        audioChunksRef.current.set(event.messageId, chunks);
        updateAudioMessage(input.setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: estimateMp3DurationSeconds(
            concatBytes(chunks),
          ),
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
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [
    completeStreamedMessage,
    enqueueDisplayDelta,
    input.conversationId,
    input.isPrimeFigure,
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
