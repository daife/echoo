import type { Agent, LocalMessage } from "@echoo/shared";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initApp } from "../../app/bootstrap/initApp";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import { streamingAudioPlayer } from "../../features/messages/streamingAudioPlayer";
import {
  appendMessageDelta,
  createPendingTextMessage,
  mergeIncomingMessage,
  mergeLocalMessage,
  mergeSentTextMessageResult,
} from "../../services/localMessageState";

interface StreamDisplayBuffer {
  chars: string[];
  cursor: number;
  timerId: number | null;
  charsPerSecond: number;
  lastDeltaAt: number;
  completedMessage?: LocalMessage;
}

export function useConversationMessages({
  agent,
  onConversationDeleted,
}: {
  agent?: Agent;
  onConversationDeleted?: (conversationId: string) => void;
}) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [rollingBackMessageId, setRollingBackMessageId] = useState<
    string | null
  >(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  const streamBuffersRef = useRef(new Map<string, StreamDisplayBuffer>());
  const conversationId = agent?.conversationId;
  const canRollback = agent?.type === "slice-figure";

  const clearStreamBuffers = useCallback(() => {
    streamBuffersRef.current.forEach((buffer) => {
      if (buffer.timerId !== null) window.clearTimeout(buffer.timerId);
    });
    streamBuffersRef.current.clear();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await services.messageService.syncConversationMessages(conversationId));
  }, [conversationId, services.messageService]);

  const scheduleStreamDrain = useCallback((messageId: string) => {
    const buffer = streamBuffersRef.current.get(messageId);
    if (!buffer || buffer.timerId !== null) return;

    const drain = () => {
      const currentBuffer = streamBuffersRef.current.get(messageId);
      if (!currentBuffer) return;

      const nextChar = currentBuffer.chars[currentBuffer.cursor];
      if (nextChar) {
        currentBuffer.cursor += 1;
        setMessages((current) =>
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
          setMessages((current) =>
            mergeLocalMessage(
              current,
              currentBuffer.completedMessage as LocalMessage,
            ),
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
  }, []);

  const enqueueDisplayDelta = useCallback(
    (messageId: string, delta: string) => {
      if (agent?.type === "prime-figure") {
        setMessages((current) =>
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
    [agent?.type, scheduleStreamDrain],
  );

  const completeStreamedMessage = useCallback(
    (message: LocalMessage) => {
      const displayed =
        messagesRef.current.find((item) => item.id === message.id)?.content
          .text ?? "";
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

      setMessages((current) => mergeLocalMessage(current, message));
      streamBuffersRef.current.delete(message.id);
    },
    [scheduleStreamDrain],
  );

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setError(null);

    void refreshMessages()
      .catch((loadError) => {
        if (!cancelled)
          setError(
            loadError instanceof Error ? loadError.message : "加载消息失败。",
          );
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshMessages, services.messageService]);

  useEffect(() => {
    return () => {
      clearStreamBuffers();
      streamingAudioPlayer.stopAll();
    };
  }, [clearStreamBuffers, conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    void runtime.message.startRealtime();
    const unsubscribeCreated = runtime.message.onMessageCreated((message) => {
      if (message.conversationId !== conversationId) return;
      setMessages((current) =>
        mergeIncomingMessage(current, { ...message, syncStatus: "synced" }),
      );
    });
    const unsubscribeDelta = runtime.message.onMessageDelta((event) => {
      if (event.conversationId !== conversationId) return;
      enqueueDisplayDelta(event.messageId, event.delta);
    });
    const unsubscribeCompleted = runtime.message.onMessageCompleted(
      (message) => {
        if (message.conversationId !== conversationId) return;
        completeStreamedMessage({ ...message, syncStatus: "synced" });
      },
    );
    const unsubscribeAudioStarted = runtime.message.onMessageAudioStarted(
      (event) => {
        if (event.conversationId !== conversationId) return;
        streamingAudioPlayer.start(event.messageId, event.mimeType);
      },
    );
    const unsubscribeAudioChunk = runtime.message.onMessageAudioChunk(
      (event) => {
        if (event.conversationId !== conversationId) return;
        streamingAudioPlayer.append(event.messageId, event.dataBase64);
      },
    );
    const unsubscribeAudioCompleted = runtime.message.onMessageAudioCompleted(
      (event) => {
        if (event.conversationId !== conversationId) return;
        streamingAudioPlayer.complete(event.messageId);
      },
    );
    const unsubscribeAudioFailed = runtime.message.onMessageAudioFailed(
      (event) => {
        if (event.conversationId !== conversationId) return;
        streamingAudioPlayer.stop(event.messageId);
      },
    );

    return () => {
      unsubscribeCreated();
      unsubscribeDelta();
      unsubscribeCompleted();
      unsubscribeAudioStarted();
      unsubscribeAudioChunk();
      unsubscribeAudioCompleted();
      unsubscribeAudioFailed();
    };
  }, [
    completeStreamedMessage,
    conversationId,
    enqueueDisplayDelta,
    runtime.message,
    services.messageService,
  ]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || isSending) return;

    const failedOutgoingMessages = messagesRef.current.filter(
      (message) =>
        message.conversationId === conversationId &&
        message.role === "user" &&
        message.status === "failed" &&
        message.syncStatus === "failed",
    );
    const pending = createPendingTextMessage({ conversationId, text });
    const clientMessageId = pending.clientMessageId ?? pending.id;

    setDraft("");
    setError(null);
    setIsSending(true);
    setMessages((current) => [
      ...current.filter(
        (message) =>
          message.id !== clientMessageId &&
          !failedOutgoingMessages.some((failed) => failed.id === message.id),
      ),
      pending,
    ]);

    try {
      const result = await services.messageService.sendTextMessage({
        conversationId,
        text,
        clientMessageId,
        stream: true,
      });
      setMessages((current) =>
        mergeSentTextMessageResult(current, clientMessageId, result),
      );
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "发送消息失败。",
      );
      await refreshMessages();
    } finally {
      setIsSending(false);
    }
  };

  const retryFailedMessage = async (messageId: string) => {
    if (!conversationId || isSending || retryingMessageId) return;
    const failedMessage = messagesRef.current.find(
      (message) => message.id === messageId,
    );
    const text = failedMessage?.content.text?.trim();
    if (
      !failedMessage ||
      failedMessage.status !== "failed" ||
      failedMessage.role !== "user" ||
      !text
    )
      return;

    const clientMessageId = failedMessage.clientMessageId ?? failedMessage.id;
    const pending: LocalMessage = {
      ...failedMessage,
      id: clientMessageId,
      clientMessageId,
      status: "pending",
      syncStatus: "pending",
      updatedAt: Date.now(),
    };

    setError(null);
    setRetryingMessageId(messageId);
    setMessages((current) =>
      mergeLocalMessage(
        current.filter((message) => message.id !== messageId),
        pending,
      ),
    );

    try {
      const result = await services.messageService.sendTextMessage({
        conversationId,
        text,
        clientMessageId,
        stream: true,
      });
      setMessages((current) =>
        mergeSentTextMessageResult(current, clientMessageId, result),
      );
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试失败。");
      await refreshMessages();
    } finally {
      setRetryingMessageId(null);
    }
  };

  const deleteConversation = async () => {
    if (!conversationId || isDeletingConversation) return;
    const confirmed = window.confirm(
      "确定要删除这个会话吗？会话与消息将从服务器永久删除。",
    );
    if (!confirmed) return;

    setError(null);
    setIsDeletingConversation(true);
    try {
      clearStreamBuffers();
      await services.messageService.deleteConversation(conversationId);
      setMessages([]);
      onConversationDeleted?.(conversationId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "删除会话失败。",
      );
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const rollbackConversation = async (messageId: string) => {
    if (!conversationId || !canRollback || rollingBackMessageId) return;

    setError(null);
    setRollingBackMessageId(messageId);
    try {
      clearStreamBuffers();
      await services.messageService.rollbackConversation(
        conversationId,
        messageId,
      );
      await refreshMessages();
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error ? rollbackError.message : "回溯失败。",
      );
    } finally {
      setRollingBackMessageId(null);
    }
  };

  return {
    messages,
    draft,
    setDraft,
    isSending,
    rollingBackMessageId,
    isDeletingConversation,
    error,
    canRollback,
    sendMessage,
    retryFailedMessage,
    deleteConversation,
    rollbackConversation,
  };
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
