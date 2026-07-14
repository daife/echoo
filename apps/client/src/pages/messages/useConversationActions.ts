import type { LocalMessage } from "@echoo/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState } from "react";
import type { MessageService } from "../../services/MessageService";
import { mergeLocalMessage } from "../../services/localMessageState";
import { mediaCache } from "../../services/mediaCache";

export function useConversationActions(input: {
  conversationId?: string;
  canRollback: boolean;
  messageService: MessageService;
  messagesRef: RefObject<LocalMessage[]>;
  activeConversationIdRef: RefObject<string | undefined>;
  setMessages: Dispatch<SetStateAction<LocalMessage[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  clearStreamBuffers: () => void;
  refreshMessages: (replace?: boolean) => Promise<void>;
  onConversationDeleted?: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [rollingBackMessageId, setRollingBackMessageId] = useState<
    string | null
  >(null);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(
    null,
  );
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  const deleteConversation = async () => {
    const conversationId = input.conversationId;
    if (!conversationId || isDeletingConversation) return;
    if (!window.confirm("确定要删除这个会话吗？会话与消息将从服务器永久删除。"))
      return;
    input.setError(null);
    setIsDeletingConversation(true);
    try {
      input.clearStreamBuffers();
      const mediaUrls = input.messagesRef.current.map(
        (message) => message.content.mediaUrl,
      );
      await input.messageService.deleteConversation(conversationId);
      await mediaCache.delete(mediaUrls);
      queryClient.removeQueries({
        queryKey: ["conversation-messages", conversationId],
        exact: true,
      });
      if (input.activeConversationIdRef.current === conversationId) {
        input.setMessages([]);
        input.messagesRef.current = [];
      }
      input.onConversationDeleted?.(conversationId);
    } catch (error) {
      input.setError(error instanceof Error ? error.message : "删除会话失败。");
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const rollbackConversation = async (messageId: string) => {
    const conversationId = input.conversationId;
    if (!conversationId || !input.canRollback || rollingBackMessageId) return;
    input.setError(null);
    setRollingBackMessageId(messageId);
    try {
      input.clearStreamBuffers();
      await input.messageService.rollbackConversation(
        conversationId,
        messageId,
      );
      await input.refreshMessages(true);
    } catch (error) {
      input.setError(error instanceof Error ? error.message : "回溯失败。");
    } finally {
      setRollingBackMessageId(null);
    }
  };

  const updateAssistantMessage = async (messageId: string, text: string) => {
    const conversationId = input.conversationId;
    if (!conversationId || updatingMessageId) return;
    input.setError(null);
    setUpdatingMessageId(messageId);
    try {
      const result = await input.messageService.updateAssistantMessage(
        conversationId,
        messageId,
        text,
      );
      input.setMessages((current) => {
        const sequence = result.message.sequence;
        const withoutInvalidSummaries =
          typeof sequence === "number"
            ? current.filter((message) => {
                if (message.metadata?.kind !== "memory_summary") return true;
                const covered = message.metadata.coveredThroughSequence;
                return typeof covered !== "number" || covered < sequence;
              })
            : current;
        return mergeLocalMessage(withoutInvalidSummaries, {
          ...result.message,
          syncStatus: "synced",
        });
      });
    } catch (error) {
      input.setError(error instanceof Error ? error.message : "修改消息失败。");
      throw error;
    } finally {
      setUpdatingMessageId(null);
    }
  };

  return {
    rollingBackMessageId,
    updatingMessageId,
    isDeletingConversation,
    deleteConversation,
    rollbackConversation,
    updateAssistantMessage,
  };
}
