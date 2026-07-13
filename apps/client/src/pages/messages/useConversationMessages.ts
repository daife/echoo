import {
  estimateMp3DurationSeconds,
  type Agent,
  type LocalMessage,
} from "@echoo/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initApp } from "../../app/bootstrap/initApp";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import {
  appendMessageDelta,
  createPendingTextMessage,
  mergeIncomingMessage,
  mergeLocalMessage,
  mergeSentTextMessageResult,
  markLocalMessageFailed,
  markLocalMessageSending,
} from "../../services/localMessageState";
import { parsePrimeFigureHintCommand } from "../../features/messages/messagePresentation";

const MESSAGE_PAGE_SIZE = 50;

interface ConversationMessageCache {
  messages: LocalMessage[];
  hasOlder: boolean;
}

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
  const queryClient = useQueryClient();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [muteUntilMs, setMuteUntilMs] = useState<number | undefined>(
    agent?.type === "prime-figure" ? agent.muteUntilMs : undefined,
  );
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [rollingBackMessageId, setRollingBackMessageId] = useState<
    string | null
  >(null);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  const hasOlderRef = useRef(false);
  const streamBuffersRef = useRef(new Map<string, StreamDisplayBuffer>());
  const audioChunksRef = useRef(new Map<string, Uint8Array[]>());
  const conversationId = agent?.conversationId;
  const activeConversationIdRef = useRef(conversationId);
  activeConversationIdRef.current = conversationId;
  const canRollback = agent?.type === "slice-figure";
  const cacheKey = useMemo(
    () => ["conversation-messages", conversationId] as const,
    [conversationId],
  );
  const agentMuteUntilMs =
    agent?.type === "prime-figure" ? agent.muteUntilMs : undefined;

  const clearStreamBuffers = useCallback(() => {
    streamBuffersRef.current.forEach((buffer) => {
      if (buffer.timerId !== null) window.clearTimeout(buffer.timerId);
    });
    streamBuffersRef.current.clear();
    audioChunksRef.current.clear();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasOlderRef.current = hasOlder;
  }, [hasOlder]);

  useEffect(() => {
    setMuteUntilMs(
      agentMuteUntilMs && agentMuteUntilMs > Date.now()
        ? agentMuteUntilMs
        : undefined,
    );
  }, [agent?.conversationId, agentMuteUntilMs]);

  useEffect(() => {
    if (!muteUntilMs) return;
    const remaining = muteUntilMs - Date.now();
    if (remaining <= 0) {
      setMuteUntilMs(undefined);
      return;
    }
    const timer = window.setTimeout(
      () => setMuteUntilMs(undefined),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [muteUntilMs]);

  const refreshMessages = useCallback(
    async (replace = false, preservePaginationState = false) => {
      if (!conversationId) {
        setMessages([]);
        return;
      }
      const latest =
        await services.messageService.loadLatestConversationMessages(
          conversationId,
          MESSAGE_PAGE_SIZE,
        );
      if (activeConversationIdRef.current !== conversationId) return;
      const next = replace
        ? latest
        : mergeMessagePages(messagesRef.current, latest);
      setMessages(next);
      if (
        latest.some(
          (message) =>
            message.role === "assistant" && message.status === "pending",
        )
      ) {
        setIsAgentActive(true);
      }
      const nextHasOlder = preservePaginationState
        ? hasOlderRef.current
        : replace
          ? latest.length === MESSAGE_PAGE_SIZE
          : hasOlderRef.current || latest.length === MESSAGE_PAGE_SIZE;
      setHasOlder(nextHasOlder);
      queryClient.setQueryData<ConversationMessageCache>(cacheKey, {
        messages: next,
        hasOlder: nextHasOlder,
      });
    },
    [cacheKey, conversationId, queryClient, services.messageService],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || isLoadingOlder || !hasOlderRef.current) return;
    const oldest = messagesRef.current.find((message) =>
      Boolean(message.id && !message.id.startsWith("client_")),
    );
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const older = await services.messageService.loadOlderConversationMessages(
        conversationId,
        oldest.id,
        MESSAGE_PAGE_SIZE,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      const next = mergeMessagePages(older, messagesRef.current);
      const nextHasOlder = older.length === MESSAGE_PAGE_SIZE;
      setMessages(next);
      setHasOlder(nextHasOlder);
      queryClient.setQueryData<ConversationMessageCache>(cacheKey, {
        messages: next,
        hasOlder: nextHasOlder,
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "加载更早消息失败。",
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    cacheKey,
    conversationId,
    isLoadingOlder,
    queryClient,
    services.messageService,
  ]);

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
    if (!conversationId) {
      setMessages([]);
      messagesRef.current = [];
      setHasOlder(false);
      hasOlderRef.current = false;
      setIsAgentActive(false);
      return;
    }

    let cancelled = false;
    const cached = queryClient.getQueryData<ConversationMessageCache>(cacheKey);
    const cachedMessages = cached?.messages ?? [];
    const cachedHasOlder = cached?.hasOlder ?? false;
    messagesRef.current = cachedMessages;
    hasOlderRef.current = cachedHasOlder;
    setMessages(cachedMessages);
    setHasOlder(cachedHasOlder);
    setIsInitialLoading(!cached);
    setIsAgentActive(false);
    setError(null);

    void refreshMessages(false, Boolean(cached))
      .catch((loadError) => {
        if (!cancelled)
          setError(
            loadError instanceof Error ? loadError.message : "加载消息失败。",
          );
      })
      .finally(() => {
        if (!cancelled) setIsInitialLoading(false);
      });

    return () => {
      cancelled = true;
      queryClient.setQueryData<ConversationMessageCache>(cacheKey, {
        messages: messagesRef.current,
        hasOlder: hasOlderRef.current,
      });
    };
  }, [cacheKey, conversationId, queryClient, refreshMessages]);

  useEffect(() => {
    return () => {
      clearStreamBuffers();
    };
  }, [clearStreamBuffers, conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    void runtime.message.startRealtime();
    const unsubscribeCreated = runtime.message.onMessageCreated((message) => {
      if (message.conversationId !== conversationId) return;
      if (message.role === "assistant" && message.status === "pending") {
        setIsAgentActive(true);
      }
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
        if (agent?.type === "prime-figure") {
          setMessages((current) => {
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
          return;
        }
        completeStreamedMessage({ ...message, syncStatus: "synced" });
      },
    );
    const unsubscribeUpdated = runtime.message.onMessageUpdated((message) => {
      if (message.conversationId !== conversationId) return;
      setMessages((current) =>
        mergeLocalMessage(current, { ...message, syncStatus: "synced" }),
      );
    });
    const unsubscribeAgentActivity =
      runtime.message.onConversationAgentActivity((event) => {
        if (event.conversationId !== conversationId) return;
        setIsAgentActive(event.active);
      });
    const unsubscribeAgentMuteChanged =
      runtime.message.onConversationAgentMuteChanged((event) => {
        if (event.conversationId !== conversationId) return;
        setMuteUntilMs(
          event.muteUntilMs && event.muteUntilMs > Date.now()
            ? event.muteUntilMs
            : undefined,
        );
      });
    const unsubscribeAudioStarted = runtime.message.onMessageAudioStarted(
      (event) => {
        if (event.conversationId !== conversationId) return;
        audioChunksRef.current.set(event.messageId, []);
        updateAudioMessage(setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: 0,
        });
      },
    );
    const unsubscribeAudioChunk = runtime.message.onMessageAudioChunk(
      (event) => {
        if (event.conversationId !== conversationId) return;
        const chunks = audioChunksRef.current.get(event.messageId) ?? [];
        chunks.push(decodeBase64(event.dataBase64));
        audioChunksRef.current.set(event.messageId, chunks);
        const bytes = concatBytes(chunks);
        updateAudioMessage(setMessages, event.messageId, {
          audioStreaming: true,
          liveAudioDurationSeconds: estimateMp3DurationSeconds(bytes),
        });
      },
    );
    const unsubscribeAudioCompleted = runtime.message.onMessageAudioCompleted(
      (event) => {
        if (event.conversationId !== conversationId) return;
        updateAudioMessage(setMessages, event.messageId, {
          audioStreaming: true,
          ...(event.mediaUrl ? { mediaUrl: event.mediaUrl } : {}),
        });
      },
    );
    const unsubscribeAudioFailed = runtime.message.onMessageAudioFailed(
      (event) => {
        if (event.conversationId !== conversationId) return;
        updateAudioMessage(setMessages, event.messageId, {
          audioStreaming: false,
        });
        audioChunksRef.current.delete(event.messageId);
      },
    );

    return () => {
      unsubscribeCreated();
      unsubscribeDelta();
      unsubscribeCompleted();
      unsubscribeUpdated();
      unsubscribeAgentActivity();
      unsubscribeAgentMuteChanged();
      unsubscribeAudioStarted();
      unsubscribeAudioChunk();
      unsubscribeAudioCompleted();
      unsubscribeAudioFailed();
    };
  }, [
    completeStreamedMessage,
    conversationId,
    enqueueDisplayDelta,
    agent?.type,
    runtime.message,
    services.messageService,
  ]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || isSending) return;

    const hintCommand = parsePrimeFigureHintCommand(text);
    if (agent?.type === "prime-figure" && hintCommand !== null) {
      const instruction = hintCommand;
      if (!instruction) {
        setError("请在 /hint 后输入调试指令。");
        return;
      }
      setDraft("");
      setError(null);
      setIsSending(true);
      setIsAgentActive(true);
      try {
        await services.messageService.triggerPrimeFigureHint(
          conversationId,
          instruction,
        );
      } catch (sendError) {
        setError(
          sendError instanceof Error ? sendError.message : "调试指令发送失败。",
        );
        setIsAgentActive(false);
      } finally {
        setIsSending(false);
      }
      return;
    }

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
    setIsAgentActive(true);
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
      if (activeConversationIdRef.current !== conversationId) return;
      setMessages((current) =>
        mergeSentTextMessageResult(current, clientMessageId, result),
      );
    } catch (sendError) {
      if (activeConversationIdRef.current !== conversationId) return;
      setError(
        sendError instanceof Error ? sendError.message : "发送消息失败。",
      );
      setMessages((current) =>
        markLocalMessageFailed(current, clientMessageId),
      );
      setIsAgentActive(false);
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

    const pending = markLocalMessageSending(failedMessage);
    const clientMessageId = pending.clientMessageId ?? pending.id;

    setError(null);
    setRetryingMessageId(messageId);
    setIsAgentActive(true);
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
      if (activeConversationIdRef.current !== conversationId) return;
      setMessages((current) =>
        mergeSentTextMessageResult(current, clientMessageId, result),
      );
    } catch (retryError) {
      if (activeConversationIdRef.current !== conversationId) return;
      setError(retryError instanceof Error ? retryError.message : "重试失败。");
      setMessages((current) =>
        markLocalMessageFailed(current, clientMessageId),
      );
      setIsAgentActive(false);
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
      queryClient.removeQueries({ queryKey: cacheKey, exact: true });
      if (activeConversationIdRef.current === conversationId) {
        setMessages([]);
        messagesRef.current = [];
      }
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
      await refreshMessages(true);
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error ? rollbackError.message : "回溯失败。",
      );
    } finally {
      setRollingBackMessageId(null);
    }
  };

  const updateAssistantMessage = async (messageId: string, text: string) => {
    if (!conversationId || updatingMessageId) return;
    setError(null);
    setUpdatingMessageId(messageId);
    try {
      const result = await services.messageService.updateAssistantMessage(
        conversationId,
        messageId,
        text,
      );
      setMessages((current) =>
        mergeLocalMessage(current, { ...result.message, syncStatus: "synced" }),
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "修改消息失败。");
      throw updateError;
    } finally {
      setUpdatingMessageId(null);
    }
  };

  return {
    messages,
    draft,
    setDraft,
    isSending,
    isAgentActive,
    isAgentMuted: Boolean(muteUntilMs && muteUntilMs > Date.now()),
    isInitialLoading,
    isLoadingOlder,
    hasOlder,
    rollingBackMessageId,
    isDeletingConversation,
    error,
    canRollback,
    sendMessage,
    loadOlderMessages,
    retryFailedMessage,
    deleteConversation,
    rollbackConversation,
    updateAssistantMessage,
    updatingMessageId,
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

function mergeMessagePages(...pages: LocalMessage[][]) {
  return pages.reduce<LocalMessage[]>((current, page) => {
    return page.reduce(
      (merged, message) => mergeIncomingMessage(merged, message),
      current,
    );
  }, []);
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
                ? {
                    liveAudioDurationSeconds:
                      patch.liveAudioDurationSeconds,
                  }
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
