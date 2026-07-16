import type { Agent } from "@echoo/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { initApp } from "../../app/bootstrap/initApp";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import type { RuntimeErrorNotice } from "../../features/messages/messagePresentation";
import { useConversationActions } from "./useConversationActions";
import { useConversationRealtime } from "./useConversationRealtime";
import { useConversationTimeline } from "./useConversationTimeline";
import { useOutgoingMessages } from "./useOutgoingMessages";

export function useConversationMessages({
  agent,
  onConversationDeleted,
}: {
  agent?: Agent;
  onConversationDeleted?: (conversationId: string) => void;
}) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeErrorNotice, setRuntimeErrorNotice] =
    useState<RuntimeErrorNotice | null>(null);
  const conversationId = agent?.conversationId;
  const isPrimeFigure = agent?.type === "prime-figure";
  const canRollback = agent?.type === "slice-figure";
  const agentMuteUntilMs = isPrimeFigure ? agent.muteUntilMs : undefined;
  const [muteUntilMs, setMuteUntilMs] = useState<number | undefined>(
    agentMuteUntilMs,
  );
  const clearRuntimeErrorNotice = useCallback(
    () => setRuntimeErrorNotice(null),
    [],
  );

  useEffect(() => setRuntimeErrorNotice(null), [conversationId]);

  useEffect(() => {
    setMuteUntilMs(
      agentMuteUntilMs && agentMuteUntilMs > Date.now()
        ? agentMuteUntilMs
        : undefined,
    );
  }, [conversationId, agentMuteUntilMs]);

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

  const timeline = useConversationTimeline({
    conversationId,
    isPrimeFigure,
    messageService: services.messageService,
    setIsAgentActive,
    setError,
  });
  const realtime = useConversationRealtime({
    runtime: runtime.message,
    conversationId,
    isPrimeFigure,
    messagesRef: timeline.messagesRef,
    setMessages: timeline.setMessages,
    setIsAgentActive,
    setMuteUntilMs,
    onRuntimeError: setRuntimeErrorNotice,
  });
  const outgoing = useOutgoingMessages({
    conversationId,
    isPrimeFigure,
    messageService: services.messageService,
    messagesRef: timeline.messagesRef,
    activeConversationIdRef: timeline.activeConversationIdRef,
    setMessages: timeline.setMessages,
    setIsAgentActive,
    setError,
  });
  const actions = useConversationActions({
    conversationId,
    canRollback,
    messageService: services.messageService,
    messagesRef: timeline.messagesRef,
    activeConversationIdRef: timeline.activeConversationIdRef,
    setMessages: timeline.setMessages,
    setError,
    clearStreamBuffers: realtime.clearStreamBuffers,
    refreshMessages: timeline.refreshMessages,
    onConversationDeleted,
  });

  return {
    messages: timeline.messages,
    draft: outgoing.draft,
    setDraft: outgoing.setDraft,
    isSending: outgoing.isSending,
    isAgentActive,
    isAgentMuted: Boolean(muteUntilMs && muteUntilMs > Date.now()),
    isInitialLoading: timeline.isInitialLoading,
    isLoadingOlder: timeline.isLoadingOlder,
    isLoadingNewer: timeline.isLoadingNewer,
    isJumpingToLatest: timeline.isJumpingToLatest,
    hasOlder: timeline.hasOlder,
    hasNewer: timeline.hasNewer,
    rollingBackMessageId: actions.rollingBackMessageId,
    isDeletingConversation: actions.isDeletingConversation,
    error,
    runtimeErrorNotice,
    clearRuntimeErrorNotice,
    canRollback,
    sendMessage: outgoing.sendMessage,
    sendImage: outgoing.sendImage,
    sendVideo: outgoing.sendVideo,
    sendVoice: outgoing.sendVoice,
    sendSticker: outgoing.sendSticker,
    sendTransfer: outgoing.sendTransfer,
    resolveTransfer: outgoing.resolveTransfer,
    loadOlderMessages: timeline.loadOlderMessages,
    loadNewerMessages: timeline.loadNewerMessages,
    jumpToLatest: timeline.jumpToLatest,
    retryFailedMessage: outgoing.retryFailedMessage,
    deleteConversation: actions.deleteConversation,
    rollbackConversation: actions.rollbackConversation,
    updateAssistantMessage: actions.updateAssistantMessage,
    updatingMessageId: actions.updatingMessageId,
  };
}
