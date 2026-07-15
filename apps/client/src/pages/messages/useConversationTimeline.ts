import type { LocalMessage } from "@echoo/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageService } from "../../services/MessageService";
import {
  mergeMessagePages,
  mergeNewerTimelineWindow,
  mergeOlderTimelineWindow,
} from "./conversationTimelineWindow";

const MESSAGE_PAGE_SIZE = 50;
const MAX_WINDOW_MESSAGES = 300;

interface ConversationMessageCache {
  messages: LocalMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
}

export function useConversationTimeline(input: {
  conversationId?: string;
  isPrimeFigure: boolean;
  messageService: MessageService;
  setIsAgentActive: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);
  const [isJumpingToLatest, setIsJumpingToLatest] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const messagesRef = useRef<LocalMessage[]>([]);
  const hasOlderRef = useRef(false);
  const hasNewerRef = useRef(false);
  const activeConversationIdRef = useRef(input.conversationId);
  activeConversationIdRef.current = input.conversationId;
  const cacheKey = useMemo(
    () => ["conversation-messages", input.conversationId] as const,
    [input.conversationId],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    hasOlderRef.current = hasOlder;
  }, [hasOlder]);
  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);

  const setWindowMessages: Dispatch<SetStateAction<LocalMessage[]>> =
    useCallback((action) => {
      setMessages((current) => {
        const next = typeof action === "function" ? action(current) : action;
        if (next.length <= MAX_WINDOW_MESSAGES) return next;
        if (hasNewerRef.current) return next.slice(0, MAX_WINDOW_MESSAGES);
        hasOlderRef.current = true;
        queueMicrotask(() => setHasOlder(true));
        return next.slice(-MAX_WINDOW_MESSAGES);
      });
    }, []);

  const saveCache = useCallback(
    (next: LocalMessage[], older: boolean, newer: boolean) => {
      queryClient.setQueryData<ConversationMessageCache>(cacheKey, {
        messages: next,
        hasOlder: older,
        hasNewer: newer,
      });
    },
    [cacheKey, queryClient],
  );

  const refreshMessages = useCallback(
    async (replace = false, preservePaginationState = false) => {
      const conversationId = input.conversationId;
      if (!conversationId) {
        setMessages([]);
        return;
      }
      const page = await input.messageService.loadLatestConversationMessages(
        conversationId,
        MESSAGE_PAGE_SIZE,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      const next = replace
        ? page.items
        : mergeMessagePages(messagesRef.current, page.items).slice(
            -MAX_WINDOW_MESSAGES,
          );
      setMessages(next);
      if (
        !input.isPrimeFigure &&
        page.items.some(
          (message) =>
            message.role === "assistant" && message.status === "pending",
        )
      )
        input.setIsAgentActive(true);
      const nextHasOlder = preservePaginationState
        ? hasOlderRef.current
        : page.pageInfo.hasOlder;
      setHasOlder(nextHasOlder);
      setHasNewer(false);
      saveCache(next, nextHasOlder, false);
    },
    [
      input.conversationId,
      input.isPrimeFigure,
      input.messageService,
      input.setIsAgentActive,
      saveCache,
    ],
  );

  const loadOlderMessages = useCallback(async () => {
    const conversationId = input.conversationId;
    if (
      !conversationId ||
      isLoadingOlder ||
      isLoadingNewer ||
      isJumpingToLatest ||
      !hasOlderRef.current
    )
      return;
    const oldest = messagesRef.current.find((message) =>
      Boolean(message.id && !message.id.startsWith("client_")),
    );
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const page = await input.messageService.loadOlderConversationMessages(
        conversationId,
        oldest.id,
        MESSAGE_PAGE_SIZE,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      const window = mergeOlderTimelineWindow({
        current: messagesRef.current,
        incoming: page.items,
        maximumMessages: MAX_WINDOW_MESSAGES,
        hasNewer: hasNewerRef.current,
      });
      const next = window.messages;
      const nextHasNewer = window.oppositeEdgeMissing;
      setMessages(next);
      setHasOlder(page.pageInfo.hasOlder);
      setHasNewer(nextHasNewer);
      saveCache(next, page.pageInfo.hasOlder, nextHasNewer);
    } catch (error) {
      input.setError(
        error instanceof Error ? error.message : "加载更早消息失败。",
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    input.conversationId,
    input.messageService,
    input.setError,
    isLoadingOlder,
    isLoadingNewer,
    isJumpingToLatest,
    saveCache,
  ]);

  const loadNewerMessages = useCallback(async () => {
    const conversationId = input.conversationId;
    if (
      !conversationId ||
      isLoadingOlder ||
      isLoadingNewer ||
      isJumpingToLatest ||
      !hasNewerRef.current
    )
      return;
    const newest = [...messagesRef.current]
      .reverse()
      .find((message) =>
        Boolean(message.id && !message.id.startsWith("client_")),
      );
    if (!newest) return;
    setIsLoadingNewer(true);
    try {
      const page = await input.messageService.loadNewerConversationMessages(
        conversationId,
        newest.id,
        MESSAGE_PAGE_SIZE,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      const window = mergeNewerTimelineWindow({
        current: messagesRef.current,
        incoming: page.items,
        maximumMessages: MAX_WINDOW_MESSAGES,
        hasOlder: hasOlderRef.current,
      });
      const next = window.messages;
      const nextHasOlder = window.oppositeEdgeMissing;
      setMessages(next);
      setHasOlder(nextHasOlder);
      setHasNewer(page.pageInfo.hasNewer);
      saveCache(next, nextHasOlder, page.pageInfo.hasNewer);
    } catch (error) {
      input.setError(
        error instanceof Error ? error.message : "加载较新消息失败。",
      );
    } finally {
      setIsLoadingNewer(false);
    }
  }, [
    input.conversationId,
    input.messageService,
    input.setError,
    isLoadingOlder,
    isLoadingNewer,
    isJumpingToLatest,
    saveCache,
  ]);

  const jumpToLatest = useCallback(async () => {
    if (!input.conversationId || isJumpingToLatest) return false;
    setIsJumpingToLatest(true);
    input.setError(null);
    try {
      await refreshMessages(true);
      return true;
    } catch (error) {
      input.setError(
        error instanceof Error ? error.message : "加载最新消息失败。",
      );
      return false;
    } finally {
      setIsJumpingToLatest(false);
    }
  }, [
    input.conversationId,
    input.setError,
    isJumpingToLatest,
    refreshMessages,
  ]);

  useEffect(() => {
    const conversationId = input.conversationId;
    if (!conversationId) {
      setMessages([]);
      messagesRef.current = [];
      setHasOlder(false);
      setHasNewer(false);
      hasOlderRef.current = false;
      hasNewerRef.current = false;
      input.setIsAgentActive(false);
      return;
    }
    let cancelled = false;
    const cached = queryClient.getQueryData<ConversationMessageCache>(cacheKey);
    const cachedMessages = cached?.messages ?? [];
    const cachedHasOlder = cached?.hasOlder ?? false;
    const cachedHasNewer = cached?.hasNewer ?? false;
    messagesRef.current = cachedMessages;
    hasOlderRef.current = cachedHasOlder;
    hasNewerRef.current = cachedHasNewer;
    setMessages(cachedMessages);
    setHasOlder(cachedHasOlder);
    setHasNewer(cachedHasNewer);
    setIsInitialLoading(!cached);
    input.setIsAgentActive(false);
    input.setError(null);

    void refreshMessages(false, Boolean(cached))
      .catch((error) => {
        if (!cancelled)
          input.setError(
            error instanceof Error ? error.message : "加载消息失败。",
          );
      })
      .finally(() => {
        if (!cancelled) setIsInitialLoading(false);
      });
    return () => {
      cancelled = true;
      saveCache(messagesRef.current, hasOlderRef.current, hasNewerRef.current);
    };
  }, [
    cacheKey,
    input.conversationId,
    input.setError,
    input.setIsAgentActive,
    queryClient,
    refreshMessages,
    saveCache,
  ]);

  return {
    messages,
    setMessages: setWindowMessages,
    messagesRef,
    activeConversationIdRef,
    isInitialLoading,
    isLoadingOlder,
    isLoadingNewer,
    isJumpingToLatest,
    hasOlder,
    hasNewer,
    refreshMessages,
    loadOlderMessages,
    loadNewerMessages,
    jumpToLatest,
  };
}
