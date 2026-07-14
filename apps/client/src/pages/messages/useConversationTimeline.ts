import type { LocalMessage } from "@echoo/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageService } from "../../services/MessageService";
import { mergeIncomingMessage } from "../../services/localMessageState";

const MESSAGE_PAGE_SIZE = 50;

interface ConversationMessageCache {
  messages: LocalMessage[];
  hasOlder: boolean;
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
  const [hasOlder, setHasOlder] = useState(false);
  const messagesRef = useRef<LocalMessage[]>([]);
  const hasOlderRef = useRef(false);
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

  const refreshMessages = useCallback(
    async (replace = false, preservePaginationState = false) => {
      const conversationId = input.conversationId;
      if (!conversationId) {
        setMessages([]);
        return;
      }
      const latest = await input.messageService.loadLatestConversationMessages(
        conversationId,
        MESSAGE_PAGE_SIZE,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      const next = replace
        ? latest
        : mergeMessagePages(messagesRef.current, latest);
      setMessages(next);
      if (
        !input.isPrimeFigure &&
        latest.some(
          (message) =>
            message.role === "assistant" && message.status === "pending",
        )
      ) {
        input.setIsAgentActive(true);
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
    [
      cacheKey,
      input.conversationId,
      input.isPrimeFigure,
      input.messageService,
      input.setIsAgentActive,
      queryClient,
    ],
  );

  const loadOlderMessages = useCallback(async () => {
    const conversationId = input.conversationId;
    if (!conversationId || isLoadingOlder || !hasOlderRef.current) return;
    const oldest = messagesRef.current.find((message) =>
      Boolean(message.id && !message.id.startsWith("client_")),
    );
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const older = await input.messageService.loadOlderConversationMessages(
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
    } catch (error) {
      input.setError(
        error instanceof Error ? error.message : "加载更早消息失败。",
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    cacheKey,
    input.conversationId,
    input.messageService,
    input.setError,
    isLoadingOlder,
    queryClient,
  ]);

  useEffect(() => {
    const conversationId = input.conversationId;
    if (!conversationId) {
      setMessages([]);
      messagesRef.current = [];
      setHasOlder(false);
      hasOlderRef.current = false;
      input.setIsAgentActive(false);
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
      queryClient.setQueryData<ConversationMessageCache>(cacheKey, {
        messages: messagesRef.current,
        hasOlder: hasOlderRef.current,
      });
    };
  }, [
    cacheKey,
    input.conversationId,
    input.setError,
    input.setIsAgentActive,
    queryClient,
    refreshMessages,
  ]);

  return {
    messages,
    setMessages,
    messagesRef,
    activeConversationIdRef,
    isInitialLoading,
    isLoadingOlder,
    hasOlder,
    refreshMessages,
    loadOlderMessages,
  };
}

function mergeMessagePages(...pages: LocalMessage[][]) {
  return pages.reduce<LocalMessage[]>((current, page) => {
    return page.reduce(
      (merged, message) => mergeIncomingMessage(merged, message),
      current,
    );
  }, []);
}
