import type { LocalMessage } from "@echoo/shared";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import type { MessageService } from "../../services/MessageService";
import {
  createPendingMediaMessage,
  createPendingTextMessage,
  markLocalMessageFailed,
  markLocalMessageSending,
  mergeLocalMessage,
  mergeSentMessageResult,
} from "../../services/localMessageState";
import { mediaCache } from "../../services/mediaCache";
import { parsePrimeFigureHintCommand } from "../../features/messages/messagePresentation";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  readImageDimensions,
} from "../../shared/utils/imageCompression";

interface PendingMediaPayload {
  contentType: "image" | "voice";
  blob: Blob;
  fileName: string;
  objectUrl: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export function useOutgoingMessages(input: {
  conversationId?: string;
  isPrimeFigure: boolean;
  messageService: MessageService;
  messagesRef: RefObject<LocalMessage[]>;
  activeConversationIdRef: RefObject<string | undefined>;
  setMessages: Dispatch<SetStateAction<LocalMessage[]>>;
  setIsAgentActive: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const pendingMediaRef = useRef(new Map<string, PendingMediaPayload>());

  useEffect(
    () => () => {
      pendingMediaRef.current.forEach((payload) =>
        URL.revokeObjectURL(payload.objectUrl),
      );
      pendingMediaRef.current.clear();
    },
    [],
  );

  const transmitMedia = async (
    payload: PendingMediaPayload,
    clientMessageId: string,
  ) => {
    const uploaded = await input.messageService.uploadMedia({
      contentType: payload.contentType,
      blob: payload.blob,
      fileName: payload.fileName,
    });
    return payload.contentType === "voice"
      ? input.messageService.sendMediaMessage({
          conversationId: input.conversationId!,
          contentType: "voice",
          resourceId: uploaded.resourceId,
          durationSeconds: payload.durationSeconds ?? 1,
          clientMessageId,
        })
      : input.messageService.sendMediaMessage({
          conversationId: input.conversationId!,
          contentType: "image",
          resourceId: uploaded.resourceId,
          clientMessageId,
        });
  };

  const releaseMedia = (
    clientMessageId: string,
    payload: PendingMediaPayload,
  ) => {
    pendingMediaRef.current.delete(clientMessageId);
    URL.revokeObjectURL(payload.objectUrl);
  };

  const releaseMediaAfterPaint = (
    clientMessageId: string,
    payload: PendingMediaPayload,
  ) => {
    pendingMediaRef.current.delete(clientMessageId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        URL.revokeObjectURL(payload.objectUrl);
      });
    });
  };

  const cacheSentMedia = (payload: PendingMediaPayload, mediaUrl?: string) => {
    if (mediaUrl) void mediaCache.put(mediaUrl, payload.blob);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    const conversationId = input.conversationId;
    if (!text || !conversationId || isSending) return;

    const hintCommand = parsePrimeFigureHintCommand(text);
    if (input.isPrimeFigure && hintCommand !== null) {
      if (!hintCommand) {
        input.setError("请在 /hint 后输入调试指令。");
        return;
      }
      setDraft("");
      input.setError(null);
      setIsSending(true);
      try {
        await input.messageService.triggerPrimeFigureHint(
          conversationId,
          hintCommand,
        );
      } catch (error) {
        input.setError(
          error instanceof Error ? error.message : "调试指令发送失败。",
        );
        input.setIsAgentActive(false);
      } finally {
        setIsSending(false);
      }
      return;
    }

    const failedOutgoingMessages = input.messagesRef.current.filter(
      (message) =>
        message.conversationId === conversationId &&
        message.role === "user" &&
        message.contentType === "text" &&
        message.status === "failed" &&
        message.syncStatus === "failed",
    );
    const pending = createPendingTextMessage({ conversationId, text });
    const clientMessageId = pending.clientMessageId!;
    setDraft("");
    input.setError(null);
    setIsSending(true);
    if (!input.isPrimeFigure) input.setIsAgentActive(true);
    input.setMessages((current) => [
      ...current.filter(
        (message) =>
          message.id !== clientMessageId &&
          !failedOutgoingMessages.some((failed) => failed.id === message.id),
      ),
      pending,
    ]);
    try {
      const result = await input.messageService.sendTextMessage({
        conversationId,
        text,
        clientMessageId,
      });
      if (input.activeConversationIdRef.current !== conversationId) return;
      input.setMessages((current) =>
        mergeSentMessageResult(current, clientMessageId, result),
      );
    } catch (error) {
      if (input.activeConversationIdRef.current !== conversationId) return;
      input.setError(error instanceof Error ? error.message : "发送消息失败。");
      input.setMessages((current) =>
        markLocalMessageFailed(current, clientMessageId),
      );
      input.setIsAgentActive(false);
    } finally {
      setIsSending(false);
    }
  };

  const sendMediaMessage = async (payload: PendingMediaPayload) => {
    const conversationId = input.conversationId;
    if (!conversationId || !input.isPrimeFigure || isSending) {
      URL.revokeObjectURL(payload.objectUrl);
      return;
    }
    if (
      payload.contentType === "image" &&
      payload.blob.size > MAX_IMAGE_UPLOAD_BYTES
    ) {
      input.setError("图片大小不能超过 5MB。");
      URL.revokeObjectURL(payload.objectUrl);
      return;
    }
    const pending = createPendingMediaMessage({
      conversationId,
      contentType: payload.contentType,
      mediaUrl: payload.objectUrl,
      fileName: payload.fileName,
      durationSeconds: payload.durationSeconds,
      width: payload.width,
      height: payload.height,
    });
    const clientMessageId = pending.clientMessageId!;
    pendingMediaRef.current.set(clientMessageId, payload);
    input.setError(null);
    setIsSending(true);
    input.setMessages((current) => mergeLocalMessage(current, pending));
    try {
      const result = await transmitMedia(payload, clientMessageId);
      cacheSentMedia(payload, result.message.content.mediaUrl);
      if (input.activeConversationIdRef.current !== conversationId) {
        releaseMedia(clientMessageId, payload);
        return;
      }
      input.setMessages((current) =>
        mergeSentMessageResult(current, clientMessageId, result),
      );
      releaseMediaAfterPaint(clientMessageId, payload);
    } catch (error) {
      if (input.activeConversationIdRef.current !== conversationId) {
        releaseMedia(clientMessageId, payload);
        return;
      }
      input.setError(error instanceof Error ? error.message : "媒体发送失败。");
      input.setMessages((current) =>
        markLocalMessageFailed(current, clientMessageId),
      );
      input.setIsAgentActive(false);
    } finally {
      setIsSending(false);
    }
  };

  const sendStructuredMessage = async (
    payload:
      | { contentType: "sticker"; stickerId: string }
      | { contentType: "transfer"; amount: number; note?: string },
  ) => {
    const conversationId = input.conversationId;
    if (!conversationId || !input.isPrimeFigure || isSending) return;
    input.setError(null);
    setIsSending(true);
    try {
      const result = await input.messageService.sendMediaMessage(
        payload.contentType === "sticker"
          ? { conversationId, ...payload }
          : { conversationId, ...payload, currency: "CNY" },
      );
      if (input.activeConversationIdRef.current !== conversationId) return;
      input.setMessages((current) =>
        mergeLocalMessage(current, {
          ...result.message,
          syncStatus: "synced",
        }),
      );
    } catch (error) {
      input.setError(error instanceof Error ? error.message : "消息发送失败。");
      input.setIsAgentActive(false);
    } finally {
      setIsSending(false);
    }
  };

  const resolveTransfer = async (
    messageId: string,
    resolution: "accepted" | "rejected",
  ) => {
    const conversationId = input.conversationId;
    if (!conversationId || isSending) return;
    input.setError(null);
    setIsSending(true);
    try {
      const result = await input.messageService.resolveTransfer({
        conversationId,
        messageId,
        resolution,
      });
      if (input.activeConversationIdRef.current !== conversationId) return;
      input.setMessages((current) =>
        mergeLocalMessage(current, {
          ...result.message,
          syncStatus: "synced",
        }),
      );
    } catch (error) {
      input.setError(error instanceof Error ? error.message : "转账处理失败。");
    } finally {
      setIsSending(false);
    }
  };

  const retryFailedMessage = async (messageId: string) => {
    const conversationId = input.conversationId;
    if (!conversationId || isSending || retryingMessageId) return;
    const failedMessage = input.messagesRef.current.find(
      (message) => message.id === messageId,
    );
    const text = failedMessage?.content.text?.trim();
    const mediaPayload = pendingMediaRef.current.get(
      failedMessage?.clientMessageId ?? messageId,
    );
    if (
      !failedMessage ||
      failedMessage.status !== "failed" ||
      failedMessage.role !== "user" ||
      (!text && !mediaPayload)
    )
      return;
    const pending = markLocalMessageSending(failedMessage);
    const clientMessageId = pending.clientMessageId!;
    input.setError(null);
    setRetryingMessageId(messageId);
    if (!input.isPrimeFigure) input.setIsAgentActive(true);
    input.setMessages((current) =>
      mergeLocalMessage(
        current.filter((message) => message.id !== messageId),
        pending,
      ),
    );
    try {
      const result = mediaPayload
        ? await transmitMedia(mediaPayload, clientMessageId)
        : await input.messageService.sendTextMessage({
            conversationId,
            text: text!,
            clientMessageId,
          });
      if (mediaPayload) {
        cacheSentMedia(mediaPayload, result.message.content.mediaUrl);
      }
      if (input.activeConversationIdRef.current !== conversationId) {
        if (mediaPayload) releaseMedia(clientMessageId, mediaPayload);
        return;
      }
      input.setMessages((current) =>
        mergeSentMessageResult(current, clientMessageId, result),
      );
      if (mediaPayload) releaseMediaAfterPaint(clientMessageId, mediaPayload);
    } catch (error) {
      if (input.activeConversationIdRef.current !== conversationId) return;
      input.setError(error instanceof Error ? error.message : "重试失败。");
      input.setMessages((current) =>
        markLocalMessageFailed(current, clientMessageId),
      );
      input.setIsAgentActive(false);
    } finally {
      setRetryingMessageId(null);
    }
  };

  return {
    draft,
    setDraft,
    isSending,
    sendMessage,
    sendImage: async (file: File) => {
      const dimensions = await readImageDimensions(file);
      return sendMediaMessage({
        contentType: "image",
        blob: file,
        fileName: file.name,
        objectUrl: URL.createObjectURL(file),
        ...dimensions,
      });
    },
    sendVoice: (blob: Blob, durationSeconds: number) =>
      sendMediaMessage({
        contentType: "voice",
        blob,
        fileName: `voice_${Date.now()}.mp3`,
        objectUrl: URL.createObjectURL(blob),
        durationSeconds,
      }),
    sendSticker: (stickerId: string) =>
      sendStructuredMessage({ contentType: "sticker", stickerId }),
    sendTransfer: (amount: number, note?: string) =>
      sendStructuredMessage({ contentType: "transfer", amount, note }),
    resolveTransfer,
    retryFailedMessage,
  };
}
