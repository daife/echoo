import {
  Copy,
  GearSix,
  PencilSimple,
  SlidersHorizontal,
  Trash,
  Waveform,
  X,
} from "@phosphor-icons/react";
import {
  type Agent,
  type AddPrimeFigureStickerRequest,
  type AgentExportResponse,
  type CreatePrimeFigureRequest,
  type CreateSliceFigureRequest,
  type ConversationRuntimeConfigPatchRequest,
  type ConversationRuntimeConfigResponse,
  type LocalMessage,
  type PrimeFigureEditSnapshot,
  type PrimeFigureAgent,
  type PrimeFigureRuntimeConfigPatch,
  type PrimeFigureRuntimeConfigView,
  type SliceFigureAgent,
  type SliceFigureRuntimeConfigPatch,
  type SliceFigureRuntimeConfigView,
  type UpdatePrimeFigurePreferencesRequest,
  type UpdatePrimeFigureRequest,
  type UpdateSliceFigureRequest,
} from "@echoo/shared";
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAuth } from "../../app/providers/AuthProvider";
import {
  MessageBubble,
  type MessageBubbleModel,
} from "../../features/messages/components/MessageBubble";
import { MessageComposer } from "../../features/messages/components/MessageComposer";
import {
  formatConversationTime,
  getPrimeRuntimeErrorText,
  getOutgoingDeliveryState,
  isVisibleConversationMessage,
  getConversationPresenceLabel,
  getPrimePresencePhaseDuration,
  type PrimePresencePhase,
  shouldShowFigurePendingIndicator,
  shouldShowTimelineItemTime,
  splitFigureReply,
} from "../../features/messages/messagePresentation";
import {
  buildSlicePayload,
  PrimeFigureForm,
  SliceFigureFormFields,
} from "../create-agent/CreateAgentPage";
import { useConversationMessages } from "./useConversationMessages";
import { imageFileToUpload } from "../../shared/utils/imageCompression";
import {
  PrimeRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "../../features/runtime-config/RuntimeConfigForms";

export type UpdateAgentHandlers = {
  "slice-figure": (
    agentId: string,
    input: UpdateSliceFigureRequest,
  ) => Promise<Agent>;
  "prime-figure": (
    agentId: string,
    input: UpdatePrimeFigureRequest,
  ) => Promise<Agent>;
  updatePrimeFigurePreferences: (
    agentId: string,
    input: UpdatePrimeFigurePreferencesRequest,
  ) => Promise<Agent>;
  addPrimeFigureSticker: (
    agentId: string,
    input: AddPrimeFigureStickerRequest,
  ) => Promise<Agent>;
  getPrimeFigureEditSnapshot: (
    agentId: string,
  ) => Promise<PrimeFigureEditSnapshot>;
  exportAgent: (agentId: string) => Promise<AgentExportResponse>;
  getConversationRuntimeConfig: (
    conversationId: string,
  ) => Promise<ConversationRuntimeConfigResponse>;
  updateConversationRuntimeConfig: (
    conversationId: string,
    patch: ConversationRuntimeConfigPatchRequest,
  ) => Promise<ConversationRuntimeConfigResponse>;
};

export function MessagesPage({
  agent,
  updateHandlers,
  onConversationDeleted,
}: {
  agent?: Agent;
  updateHandlers: UpdateAgentHandlers;
  onConversationDeleted?: (conversationId: string) => void;
}) {
  const { user } = useAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdatingAgent, setIsUpdatingAgent] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRuntimeConfigOpen, setIsRuntimeConfigOpen] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [messageBeingEdited, setMessageBeingEdited] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const {
    messages,
    draft,
    setDraft,
    isSending,
    isDeletingConversation,
    isAgentActive,
    isAgentMuted,
    isInitialLoading,
    isLoadingOlder,
    hasOlder,
    hasNewer,
    error,
    canRollback,
    sendMessage,
    sendImage,
    sendVoice,
    sendSticker,
    sendTransfer,
    resolveTransfer,
    loadOlderMessages,
    loadNewerMessages,
    jumpToLatest,
    retryFailedMessage,
    deleteConversation,
    rollbackConversation,
    updateAssistantMessage,
    updatingMessageId,
  } = useConversationMessages({ agent, onConversationDeleted });
  const mainRef = useRef<HTMLElement | null>(null);
  const virtualListRef = useRef<HTMLDivElement | null>(null);
  const [virtualScrollMargin, setVirtualScrollMargin] = useState(0);
  const shouldFollowBottomRef = useRef(true);
  const lastConversationRef = useRef<string | undefined>(undefined);
  const lastVisibleMessageIdRef = useRef<string | undefined>(undefined);
  const lastScrollTopRef = useRef(0);
  const showAgentTyping = useRhythmicPrimePresence({
    agentId: agent?.id,
    agentType: agent?.type,
    isAgentActive,
    isAgentMuted,
  });
  const title = agent?.name ?? "选择一个角色";
  const subtitle = agent
    ? getConversationPresenceLabel({
        agentTypeLabel: formatAgentType(agent),
        isAgentActive: showAgentTyping,
        isAgentMuted,
      })
    : "打开或创建一个角色以开始聊天";
  const prologueHtml =
    agent?.type === "slice-figure" || agent?.type === "prime-figure"
      ? agent.detail.prologueHtml
      : "";
  const conversationId = agent?.conversationId;

  const visibleMessages = useMemo(() => {
    if (!agent) return [];
    const visible = messages.filter(isVisibleConversationMessage);
    if (visible.length > 0)
      return visible.flatMap((message) =>
        toBubbleMessages(
          message,
          canRollback,
          agent.type === "slice-figure" && agent.detail.replyAutoSegment,
          agent.type === "slice-figure",
          agent.type,
        ),
      );
    if (agent?.type === "slice-figure" && agent.detail.openingLine) {
      return [
        {
          id: `${agent.id}-opening`,
          from: "agent",
          text: agent.detail.openingLine,
          createdAt: 0,
          kind: "text" as const,
        },
      ];
    }
    return [];
  }, [agent, canRollback, messages]);
  const messageVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => mainRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
    scrollMargin: virtualScrollMargin,
  });

  useLayoutEffect(() => {
    setVirtualScrollMargin(virtualListRef.current?.offsetTop ?? 0);
  }, [isLoadingOlder, prologueHtml, visibleMessages.length]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        settingsRef.current?.contains(event.target as Node)
      )
        return;
      setIsSettingsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [isSettingsOpen]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main || isInitialLoading) return;
    const conversationChanged = lastConversationRef.current !== conversationId;
    const latest = visibleMessages.at(-1);
    const latestChanged = lastVisibleMessageIdRef.current !== latest?.id;
    const optimisticMine =
      latest?.from === "me" && latest.deliveryState === "sending";
    if (
      conversationChanged ||
      (latestChanged && (shouldFollowBottomRef.current || optimisticMine))
    ) {
      main.scrollTop = main.scrollHeight;
      lastScrollTopRef.current = main.scrollTop;
      shouldFollowBottomRef.current = true;
    }
    lastConversationRef.current = conversationId;
    lastVisibleMessageIdRef.current = latest?.id;
  }, [conversationId, isInitialLoading, visibleMessages]);

  const handleMessageScroll = () => {
    const main = mainRef.current;
    if (!main) return;
    const scrollingUp = main.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = main.scrollTop;
    shouldFollowBottomRef.current =
      main.scrollHeight - main.scrollTop - main.clientHeight <= 120;
    if (
      !scrollingUp &&
      shouldFollowBottomRef.current &&
      hasNewer &&
      !isLoadingOlder
    ) {
      void loadNewerMessages();
      return;
    }
    if (!scrollingUp || main.scrollTop > 80 || !hasOlder || isLoadingOlder)
      return;
    const previousHeight = main.scrollHeight;
    const previousTop = main.scrollTop;
    void loadOlderMessages().finally(() => {
      window.requestAnimationFrame(() => {
        const current = mainRef.current;
        if (!current) return;
        current.scrollTop = previousTop + current.scrollHeight - previousHeight;
      });
    });
  };

  if (!agent) {
    return (
      <section className="grid h-full min-h-0 place-items-center overflow-hidden rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/[0.05]">
            <Waveform size={26} weight="thin" />
          </div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">{subtitle}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-[1.25rem] bg-[#0d0d10]/92 shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
      <header className="flex items-center justify-between border-b border-white/8 px-5 py-4 md:px-7">
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.06] text-white/75">
            <Waveform size={23} weight="duotone" />
          </div>
          <div>
            <h1 className="text-[1.05rem] font-semibold tracking-[-0.015em] text-white">
              {title}
            </h1>
            <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>
          </div>
        </div>
        <div className="relative flex items-center gap-1" ref={settingsRef}>
          <button
            aria-label="角色设置"
            aria-expanded={isSettingsOpen}
            className="grid h-9 w-9 place-items-center rounded-lg text-white/45 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white active:translate-y-px"
            type="button"
            onClick={() => setIsSettingsOpen((current) => !current)}
          >
            <GearSix size={18} />
          </button>
          {isSettingsOpen ? (
            <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-white/10 bg-[#17171b] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
              {agent.type !== "prime-world" ? (
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setEditError(null);
                    setIsEditOpen(true);
                  }}
                >
                  <PencilSimple size={16} />
                  修改角色
                </button>
              ) : null}
              {agent.type !== "prime-world" ? (
                <button
                  className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setIsRuntimeConfigOpen(true);
                  }}
                >
                  <SlidersHorizontal size={16} />
                  运行配置
                </button>
              ) : null}
              <button
                className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-45"
                disabled={isExporting}
                type="button"
                onClick={() => {
                  setIsExporting(true);
                  setExportNotice(null);
                  void updateHandlers
                    .exportAgent(agent.id)
                    .then(async (result) => {
                      await copyText(JSON.stringify(result.data, null, 2));
                      setExportNotice("角色 JSON 已复制");
                    })
                    .catch((caught) =>
                      setExportNotice(
                        caught instanceof Error ? caught.message : "导出失败。",
                      ),
                    )
                    .finally(() => setIsExporting(false));
                }}
              >
                <Copy size={16} />
                {isExporting ? "正在导出…" : "导出角色"}
              </button>
              {agent.type === "slice-figure" ? (
                <label className="mt-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm text-white/75 transition hover:bg-white/[0.06]">
                  <span>回复自动分段</span>
                  <input
                    type="checkbox"
                    checked={agent.detail.replyAutoSegment}
                    disabled={isUpdatingPreference}
                    onChange={async (event) => {
                      const checked = event.target.checked;
                      setIsUpdatingPreference(true);
                      setEditError(null);
                      try {
                        await updateHandlers["slice-figure"](agent.id, {
                          ...agentToUpdateForm(agent),
                          replyAutoSegment: checked,
                        });
                      } catch (caught) {
                        setEditError(
                          caught instanceof Error
                            ? caught.message
                            : "设置保存失败。",
                        );
                      } finally {
                        setIsUpdatingPreference(false);
                      }
                    }}
                  />
                </label>
              ) : null}
              {agent.type === "prime-figure" ? (
                <label className="mt-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm text-white/75 transition hover:bg-white/[0.06]">
                  <span>流式语音请求</span>
                  <input
                    type="checkbox"
                    checked={agent.detail.voiceRequestStreaming}
                    disabled={isUpdatingPreference}
                    onChange={async (event) => {
                      const checked = event.target.checked;
                      setIsUpdatingPreference(true);
                      setEditError(null);
                      try {
                        await updateHandlers.updatePrimeFigurePreferences(
                          agent.id,
                          { voiceRequestStreaming: checked },
                        );
                      } catch (caught) {
                        setEditError(
                          caught instanceof Error
                            ? caught.message
                            : "设置保存失败。",
                        );
                      } finally {
                        setIsUpdatingPreference(false);
                      }
                    }}
                  />
                </label>
              ) : null}
              <button
                className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-200/75 transition hover:bg-red-400/10 hover:text-red-100 disabled:opacity-40"
                disabled={isDeletingConversation}
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  void deleteConversation();
                }}
              >
                <Trash size={16} />
                删除会话
              </button>
              {editError ? (
                <p className="px-3 pb-1 pt-2 text-xs leading-5 text-red-200/75">
                  {editError}
                </p>
              ) : null}
              {exportNotice ? (
                <p className="px-3 pb-1 pt-2 text-xs leading-5 text-white/55">
                  {exportNotice}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main
        ref={mainRef}
        className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-7 no-scrollbar md:px-9"
        onScroll={handleMessageScroll}
      >
        {isLoadingOlder ? (
          <div className="mb-4 flex justify-center text-xs text-white/32">
            加载更早消息…
          </div>
        ) : null}
        {prologueHtml ? (
          <iframe
            className="max-h-[38dvh] min-h-64 w-full rounded-xl border border-white/8 bg-transparent"
            sandbox="allow-scripts"
            srcDoc={buildPrologueDocument(prologueHtml)}
            title={`${title} 的序引`}
          />
        ) : null}
        <div
          ref={virtualListRef}
          className="relative w-full"
          style={{ height: messageVirtualizer.getTotalSize() }}
        >
          {messageVirtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const message = visibleMessages[index];
            if (!message) return null;
            const showTime = shouldShowTimelineItemTime(visibleMessages, index);
            return (
              <div
                key={virtualRow.key}
                ref={messageVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 flex w-full flex-col gap-5 pb-5"
                style={{
                  transform: `translateY(${virtualRow.start - messageVirtualizer.options.scrollMargin}px)`,
                }}
              >
                {showTime ? (
                  <div className="self-center text-[11px] tabular-nums text-white/32">
                    {formatConversationTime(message.createdAt)}
                  </div>
                ) : null}
                <MessageBubble
                  message={message}
                  onRetry={retryFailedMessage}
                  onRollback={canRollback ? rollbackConversation : undefined}
                  onEdit={(messageId, text) =>
                    setMessageBeingEdited({ id: messageId, text })
                  }
                  onResolveTransfer={resolveTransfer}
                />
              </div>
            );
          })}
        </div>
        {hasNewer ? (
          <button
            className="sticky bottom-4 self-center rounded-full border border-white/10 bg-[#1a1a20] px-4 py-2 text-xs text-white/75 shadow-lg"
            type="button"
            onClick={() => void jumpToLatest()}
          >
            回到最新消息
          </button>
        ) : null}
        {error ? (
          <div className="self-center rounded-full border border-red-400/20 px-4 py-2 text-xs text-red-200/80">
            {error}
          </div>
        ) : null}
      </main>

      <MessageComposer
        key={agent.conversationId}
        title={title}
        isPrimeFigure={agent.type === "prime-figure"}
        draft={draft}
        isSending={isSending}
        onDraftChange={setDraft}
        onSendText={sendMessage}
        onSendImage={sendImage}
        onSendVoice={sendVoice}
        stickers={
          agent.type === "prime-figure" ? (agent.detail.stickers ?? []) : []
        }
        onSendSticker={sendSticker}
        onSendTransfer={sendTransfer}
        onAddSticker={async (file, description) => {
          const upload = await imageFileToUpload(file);
          await updateHandlers.addPrimeFigureSticker(agent.id, {
            upload,
            description,
          });
        }}
      />
      {isEditOpen && agent.type === "slice-figure" ? (
        <EditSliceFigureDialog
          agent={agent}
          error={editError}
          isSubmitting={isUpdatingAgent}
          user={user}
          onClose={() => {
            if (isUpdatingAgent) return;
            setIsEditOpen(false);
            setEditError(null);
          }}
          onSubmit={async (payload) => {
            setIsUpdatingAgent(true);
            setEditError(null);
            try {
              await updateHandlers["slice-figure"](agent.id, payload);
              setIsEditOpen(false);
            } catch (caught) {
              setEditError(
                caught instanceof Error
                  ? caught.message
                  : "修改失败，请稍后再试。",
              );
            } finally {
              setIsUpdatingAgent(false);
            }
          }}
        />
      ) : null}
      {isEditOpen && agent.type === "prime-figure" ? (
        <EditPrimeFigureDialog
          agent={agent}
          loadSnapshot={() =>
            updateHandlers.getPrimeFigureEditSnapshot(agent.id)
          }
          onClose={() => setIsEditOpen(false)}
          onSubmit={async (payload) => {
            await updateHandlers["prime-figure"](agent.id, payload);
            setIsEditOpen(false);
          }}
        />
      ) : null}
      {messageBeingEdited ? (
        <EditMessageDialog
          initialText={messageBeingEdited.text}
          isSubmitting={updatingMessageId === messageBeingEdited.id}
          onClose={() => {
            if (!updatingMessageId) setMessageBeingEdited(null);
          }}
          onSubmit={async (text) => {
            await updateAssistantMessage(messageBeingEdited.id, text);
            setMessageBeingEdited(null);
          }}
        />
      ) : null}
      {isRuntimeConfigOpen ? (
        <RuntimeConfigDialog
          conversationId={agent.conversationId}
          load={() =>
            updateHandlers.getConversationRuntimeConfig(agent.conversationId)
          }
          update={(patch) =>
            updateHandlers.updateConversationRuntimeConfig(
              agent.conversationId,
              patch,
            )
          }
          onClose={() => setIsRuntimeConfigOpen(false)}
        />
      ) : null}
    </section>
  );
}

function RuntimeConfigDialog({
  conversationId,
  load,
  update,
  onClose,
}: {
  conversationId: string;
  load: () => Promise<ConversationRuntimeConfigResponse>;
  update: (
    patch: ConversationRuntimeConfigPatchRequest,
  ) => Promise<ConversationRuntimeConfigResponse>;
  onClose: () => void;
}) {
  const [response, setResponse] =
    useState<ConversationRuntimeConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResponse(null);
    setError(null);
    void load()
      .then((value) => {
        if (!cancelled) setResponse(value);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "配置加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function setMode(mode: "global" | "custom") {
    setSwitching(true);
    setError(null);
    setNotice(null);
    try {
      setResponse(await update({ mode }));
      setNotice(
        mode === "global"
          ? "该会话已实时使用用户全局配置。"
          : "已创建该会话的独立配置。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模式切换失败。");
    } finally {
      setSwitching(false);
    }
  }

  async function saveConfig(
    config: SliceFigureRuntimeConfigPatch | PrimeFigureRuntimeConfigPatch,
  ) {
    setError(null);
    setNotice(null);
    try {
      setResponse(await update({ mode: "custom", config }));
      setNotice("会话独立配置已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存失败。");
      throw caught;
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.55)] md:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">会话运行配置</h2>
            <p className="mt-1 text-sm text-white/42">
              全局模式实时继承用户设置；独立模式只影响当前会话。
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.06] hover:text-white"
            type="button"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        {response ? (
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.035] p-1.5">
            <button
              disabled={switching}
              type="button"
              onClick={() => void setMode("global")}
              className={`rounded-lg px-4 py-2.5 text-sm transition ${response.mode === "global" ? "bg-white text-black" : "text-white/50 hover:text-white"}`}
            >
              使用用户全局配置
            </button>
            <button
              disabled={switching}
              type="button"
              onClick={() => void setMode("custom")}
              className={`rounded-lg px-4 py-2.5 text-sm transition ${response.mode === "custom" ? "bg-white text-black" : "text-white/50 hover:text-white"}`}
            >
              使用会话独立配置
            </button>
          </div>
        ) : null}
        {!response && !error ? (
          <p className="py-12 text-center text-sm text-white/42">
            正在读取配置…
          </p>
        ) : null}
        {response?.mode === "global" ? (
          <div className="rounded-xl border border-dashed border-white/10 px-5 py-10 text-center">
            <p className="text-sm text-white/65">
              当前会话会在每次运行时读取用户最新全局配置。
            </p>
            <p className="mt-2 text-xs text-white/35">
              切换到独立配置时，服务端会复制当前有效配置和密钥，无需密钥经过客户端。
            </p>
          </div>
        ) : null}
        {response?.mode === "custom" &&
        response.conversationType === "slice-figure" ? (
          <SliceRuntimeConfigForm
            value={response.config as SliceFigureRuntimeConfigView}
            onSave={(patch) => saveConfig(patch)}
            error={error}
            notice={notice}
          />
        ) : null}
        {response?.mode === "custom" &&
        response.conversationType === "prime-figure" ? (
          <PrimeRuntimeConfigForm
            value={response.config as PrimeFigureRuntimeConfigView}
            onSave={(patch) => saveConfig(patch)}
            error={error}
            notice={notice}
          />
        ) : null}
        {response?.conversationType === "prime-world" ? (
          <p className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-white/42">
            本初世界配置已预留，当前没有可编辑参数。
          </p>
        ) : null}
        {error && !response ? (
          <p className="text-sm text-red-200/75">{error}</p>
        ) : null}
        {notice && response?.mode === "global" ? (
          <p className="mt-4 text-center text-xs text-emerald-200/70">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EditSliceFigureDialog({
  agent,
  user,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  agent: SliceFigureAgent;
  user: { displayName: string } | null;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: UpdateSliceFigureRequest) => Promise<void>;
}) {
  const [form, setForm] = useState<CreateSliceFigureRequest>(() => ({
    type: "slice-figure",
    ...agentToUpdateForm(agent),
  }));
  const [localError, setLocalError] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [unlockText, setUnlockText] = useState(
    agent.detail.unlockConditions
      ? JSON.stringify(agent.detail.unlockConditions, null, 2)
      : "",
  );

  const updateField = (
    key: keyof CreateSliceFigureRequest,
    value: CreateSliceFigureRequest[keyof CreateSliceFigureRequest],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLocalError(null);
    setPromptPreview(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = buildSlicePayload(form, unlockText);
    if (typeof payload === "string") {
      setLocalError(payload);
      return;
    }
    const { type: _type, ...update } = payload;
    await onSubmit(update);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 py-8 backdrop-blur-sm">
      <form
        className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.55)] md:p-7"
        onSubmit={submit}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">修改切片角色</h2>
            <p className="mt-1 text-sm text-white/42">
              沿用创建角色的字段逻辑，属性和标签只用于展示。
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.06] hover:text-white"
            type="button"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <SliceFigureFormFields
          form={form}
          jsonInput={jsonInput}
          unlockText={unlockText}
          promptPreview={promptPreview}
          user={user}
          existingAvatarUrl={agent.avatarResourcePath}
          existingCoverUrl={agent.coverResourcePath}
          onApplyJson={() => {
            try {
              const parsed = JSON.parse(
                jsonInput,
              ) as Partial<CreateSliceFigureRequest>;
              const next = {
                ...form,
                ...parsed,
                type: "slice-figure" as const,
              };
              setForm(next);
              setUnlockText(
                next.unlockConditions
                  ? JSON.stringify(next.unlockConditions, null, 2)
                  : "",
              );
              setLocalError(null);
            } catch {
              setLocalError("JSON 无法解析，请检查格式。");
            }
          }}
          onJsonInputChange={setJsonInput}
          onUnlockTextChange={setUnlockText}
          onPromptPreviewChange={setPromptPreview}
          onChange={updateField}
        />

        {localError || error ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/70">
            {localError ?? error}
          </p>
        ) : null}

        <button
          className="mt-6 w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "保存中……" : "保存修改"}
        </button>
      </form>
    </div>
  );
}

function EditPrimeFigureDialog({
  agent,
  loadSnapshot,
  onClose,
  onSubmit,
}: {
  agent: PrimeFigureAgent;
  loadSnapshot: () => Promise<PrimeFigureEditSnapshot>;
  onClose: () => void;
  onSubmit: (payload: UpdatePrimeFigureRequest) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<PrimeFigureEditSnapshot | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSnapshot()
      .then((value) => {
        if (!cancelled) setSnapshot(value);
      })
      .catch((caught) => {
        if (!cancelled)
          setLoadError(
            caught instanceof Error ? caught.message : "最新角色状态加载失败。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-[#101014]">
        {snapshot ? (
          <PrimeFigureForm
            mode="edit"
            initialForm={primeSnapshotToForm(snapshot)}
            existingAvatarUrl={snapshot.agent.avatarResourcePath}
            existingCoverUrl={snapshot.agent.coverResourcePath}
            existingReferenceImages={snapshot.agent.detail.referenceImages}
            existingStickers={snapshot.agent.detail.stickers ?? []}
            onClose={onClose}
            onSubmit={async (form) => onSubmit(primeFormToUpdate(form))}
          />
        ) : (
          <div className="rounded-2xl border border-white/10 p-7">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">修改本初角色</h2>
              <button
                className="grid h-9 w-9 place-items-center rounded-full text-white/50 hover:bg-white/[0.06] hover:text-white"
                type="button"
                onClick={onClose}
              >
                <X size={17} />
              </button>
            </div>
            <p
              className={`mt-6 text-sm ${loadError ? "text-red-200/80" : "text-white/48"}`}
            >
              {loadError ?? "正在读取最新角色状态……"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function primeSnapshotToForm(
  snapshot: PrimeFigureEditSnapshot,
): CreatePrimeFigureRequest {
  const { agent, state } = snapshot;
  return {
    type: "prime-figure",
    name: agent.name,
    attributes: agent.attributes,
    tags: agent.tags,
    introduction: agent.introduction,
    prologueHtml: agent.detail.prologueHtml,
    linkedAgentIds: agent.detail.linkedAgentIds,
    unlockConditions: agent.detail.unlockConditions ?? null,
    isPublic: agent.isPublic,
    persona: agent.detail.persona,
    background: agent.detail.background,
    personality: agent.detail.personality,
    responseStyle: agent.detail.responseStyle,
    decisionStyle: agent.detail.decisionStyle,
    currentSituation: agent.detail.currentSituation,
    schedule: agent.detail.schedule,
    itinerary: agent.detail.itinerary,
    variableDefinitions: agent.detail.variableDefinitions.map((definition) => ({
      ...definition,
      ...(state.variables[definition.key] !== undefined
        ? { defaultValue: state.variables[definition.key] }
        : { defaultValue: undefined }),
    })),
    referenceImages: agent.detail.referenceImages.map((item) => ({
      resourceId: item.resourceId,
      description: item.description,
    })),
    stickers: (agent.detail.stickers ?? []).map((item) => ({
      resourceId: item.resourceId,
      description: item.description,
    })),
    voiceRequestStreaming: agent.detail.voiceRequestStreaming,
    initialMood: state.mood,
    initialRelationshipStatus: state.relationshipStatus,
  };
}

export function primeFormToUpdate(
  form: CreatePrimeFigureRequest,
): UpdatePrimeFigureRequest {
  const {
    type: _type,
    initialMood = "",
    initialRelationshipStatus = "",
    ...definition
  } = form;
  const currentVariables = Object.fromEntries(
    (form.variableDefinitions ?? [])
      .filter((item) => item.defaultValue !== undefined)
      .map((item) => [item.key, item.defaultValue!]),
  );
  return {
    ...definition,
    currentVariables,
    currentMood: initialMood,
    currentRelationshipStatus: initialRelationshipStatus,
  };
}

function agentToUpdateForm(agent: SliceFigureAgent): UpdateSliceFigureRequest {
  return {
    name: agent.name,
    attributes: agent.attributes,
    tags: agent.tags,
    introduction: agent.introduction,
    prologueHtml: agent.detail.prologueHtml,
    currentSituation: agent.detail.currentSituation,
    openingLine: agent.detail.openingLine,
    isPublic: agent.isPublic,
    linkedAgentIds: agent.detail.linkedAgentIds,
    unlockConditions: agent.detail.unlockConditions ?? null,
    persona: agent.detail.persona,
    background: agent.detail.background,
    personality: agent.detail.personality,
    responseStyle: agent.detail.responseStyle,
    systemPrompt: agent.detail.systemPrompt,
    memorySummaryPrompt: agent.detail.memorySummaryPrompt,
    replyAutoSegment: agent.detail.replyAutoSegment,
  };
}

function formatAgentType(agent: Agent) {
  if (agent.type === "slice-figure") return "切片角色";
  if (agent.type === "prime-world") return "本初世界";
  return "本初角色";
}

function useRhythmicPrimePresence(input: {
  agentId?: string;
  agentType?: Agent["type"];
  isAgentActive: boolean;
  isAgentMuted: boolean;
}) {
  const [phase, setPhase] = useState<PrimePresencePhase>("typing");

  useEffect(() => {
    if (
      input.agentType !== "prime-figure" ||
      !input.isAgentActive ||
      input.isAgentMuted
    ) {
      setPhase("typing");
      return;
    }

    let currentPhase: PrimePresencePhase = "typing";
    let timerId: number | undefined;
    setPhase(currentPhase);

    const scheduleNextPhase = () => {
      timerId = window.setTimeout(() => {
        currentPhase = currentPhase === "typing" ? "online" : "typing";
        setPhase(currentPhase);
        scheduleNextPhase();
      }, getPrimePresencePhaseDuration(currentPhase));
    };

    scheduleNextPhase();
    return () => window.clearTimeout(timerId);
  }, [input.agentId, input.agentType, input.isAgentActive, input.isAgentMuted]);

  if (input.agentType !== "prime-figure") return input.isAgentActive;
  return input.isAgentActive && !input.isAgentMuted && phase === "typing";
}

function toBubbleMessages(
  message: LocalMessage,
  canRollback: boolean,
  autoSegment: boolean,
  canEditFigureMessages: boolean,
  agentType: Agent["type"],
): MessageBubbleModel[] {
  const runtimeErrorText = getPrimeRuntimeErrorText(message);
  if (runtimeErrorText)
    return [
      {
        id: message.id,
        sourceMessageId: message.id,
        from: "system",
        text: runtimeErrorText,
        createdAt: message.createdAt,
        kind: "runtime-error",
        canRollback: false,
        canEdit: false,
      },
    ];
  if (message.metadata?.kind === "memory_summary")
    return [
      {
        id: message.id,
        sourceMessageId: message.id,
        from: "system",
        text: "已自动总结对话",
        createdAt: message.createdAt,
        kind: "memory-summary",
        canRollback: false,
        canEdit: false,
      },
    ];
  const primeContent = readPrimeContent(message.metadata);
  const isSticker = primeContent?.type === "sticker";
  const isTransfer = primeContent?.type === "transfer";
  const text =
    message.contentType === "text" && !isTransfer
      ? (message.content.text ?? "")
      : "";
  const segments =
    autoSegment &&
    message.role === "assistant" &&
    message.contentType === "text" &&
    !isTransfer
      ? splitFigureReply(text)
      : [text];
  const isSegmented =
    autoSegment &&
    message.role === "assistant" &&
    message.contentType === "text";
  return segments.map((segment, index) => ({
    id: isSegmented ? `${message.id}:segment:${index}` : message.id,
    sourceMessageId: message.id,
    sourceText: text,
    isSourceStart: index === 0,
    from: message.role === "user" ? "me" : "agent",
    text: segment,
    createdAt: message.createdAt,
    deliveryState: getOutgoingDeliveryState(message),
    kind:
      message.contentType === "voice"
        ? "voice"
        : isSticker
          ? "sticker"
          : isTransfer
            ? "transfer"
            : message.contentType === "image"
              ? "image"
              : "text",
    mediaUrl:
      message.content.mediaUrl ??
      (message.content.media?.resourceId
        ? `/api/resources/${message.content.media.resourceId}/file`
        : undefined),
    transcript:
      message.contentType === "voice" ? message.content.text : undefined,
    durationSeconds:
      message.contentType === "voice"
        ? getVoiceDurationSeconds(message.metadata)
        : undefined,
    transferAmount:
      isTransfer && typeof primeContent.amount === "number"
        ? primeContent.amount
        : undefined,
    transferCurrency: isTransfer ? "CNY" : undefined,
    transferStatus:
      isTransfer &&
      (primeContent.status === "pending" ||
        primeContent.status === "accepted" ||
        primeContent.status === "rejected")
        ? primeContent.status
        : undefined,
    transferDirection:
      isTransfer &&
      (primeContent.direction === "received" ||
        primeContent.direction === "paid")
        ? primeContent.direction
        : undefined,
    transferNote:
      isTransfer && typeof primeContent.note === "string"
        ? primeContent.note
        : undefined,
    canRollback,
    canEdit:
      canEditFigureMessages &&
      message.role === "assistant" &&
      message.contentType === "text" &&
      !isTransfer &&
      message.status !== "pending" &&
      message.status !== "failed",
    isPending:
      shouldShowFigurePendingIndicator(message, agentType) &&
      index === segments.length - 1,
  }));
}

function readPrimeContent(metadata: LocalMessage["metadata"]) {
  const value = metadata?.primeContent;
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return type === "sticker" || type === "transfer"
    ? (value as Record<string, unknown> & { type: "sticker" | "transfer" })
    : null;
}

function EditMessageDialog({
  initialText,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  initialText: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 backdrop-blur-sm">
      <form
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.55)]"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = text.trim();
          if (!value) return setError("消息内容不能为空。");
          setError(null);
          try {
            await onSubmit(value);
          } catch (caught) {
            setError(
              caught instanceof Error ? caught.message : "修改消息失败。",
            );
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">修改角色回复</h2>
          <button
            aria-label="关闭"
            className="grid h-9 w-9 place-items-center rounded-lg text-white/45 hover:bg-white/[0.06] hover:text-white"
            type="button"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <p className="mt-1 text-xs text-white/40">
          自动分段仅影响显示，这里始终修改完整的一轮回复。
        </p>
        <textarea
          autoFocus
          className="mt-4 min-h-44 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white/25"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {error ? <p className="mt-3 text-sm text-red-200/80">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-4 py-2 text-sm text-white/55 hover:bg-white/[0.05] hover:text-white"
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-45"
            disabled={isSubmitting || !text.trim()}
            type="submit"
          >
            {isSubmitting ? "保存中…" : "保存修改"}
          </button>
        </div>
      </form>
    </div>
  );
}

function getVoiceDurationSeconds(metadata: LocalMessage["metadata"]) {
  const live = metadata?.liveAudioDurationSeconds;
  if (typeof live === "number" && Number.isFinite(live) && live >= 0)
    return live;
  const mediaIntent = metadata?.mediaIntent;
  if (!mediaIntent || typeof mediaIntent !== "object") return undefined;
  const duration = (mediaIntent as Record<string, unknown>).durationSeconds;
  return typeof duration === "number" && Number.isFinite(duration)
    ? duration
    : undefined;
}

function buildPrologueDocument(html: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: transparent;
        color: #f5f1ee;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        overflow-x: hidden;
      }

      img,
      video,
      canvas,
      svg {
        max-width: 100%;
      }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some desktop WebViews expose Clipboard API without granting write access.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("无法访问剪贴板，请检查系统权限。");
}
