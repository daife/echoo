import type {
  JsonObject,
  PrimeWorldAgent,
  PrimeWorldRun,
  PrimeWorldRuntimeState,
  WorldView,
  WorldViewElement,
} from "@echoo/shared";
import {
  ArrowCounterClockwise,
  PaperPlaneRight,
  Play,
  Microphone,
  SlidersHorizontal,
  Trash,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import type { PrimeWorldService } from "../../services/PrimeWorldService";
import { PrimeWorldEditorPage } from "./PrimeWorldEditorPage";
import { usePushToTalk } from "../../features/messages/usePushToTalk";
import { PrimeWorldAudioPlayer } from "./PrimeWorldAudioPlayer";
import { ConversationHeaderTitle } from "../../features/messages/components/ConversationHeaderTitle";
import { BackButton } from "../../shared/components/BackButton";

export function PrimeWorldPage({
  agent,
  service,
  onBack,
  onDelete,
  onSave,
}: {
  agent: PrimeWorldAgent;
  service: PrimeWorldService;
  onBack: () => void;
  onDelete: (conversationId: string) => Promise<void>;
  onSave: (
    detail: PrimeWorldAgent["detail"],
    preserveRuntimeState: boolean,
  ) => Promise<void>;
}) {
  const [view, setView] = useState<WorldView>(
    agent.detail.presentation.startView,
  );
  const [busy, setBusy] = useState(false);
  const [hasStarted, setHasStarted] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [offlineReadOnly, setOfflineReadOnly] = useState(false);
  const [resourceUrls, setResourceUrls] = useState(new Map<string, string>());
  useBackHandler(() => setEditing(false), {
    enabled: editing,
    priority: BACK_HANDLER_PRIORITY.fullscreen,
  });
  const [temporaryText, setTemporaryText] = useState<Record<string, string>>(
    {},
  );
  const player = useRef(new PrimeWorldAudioPlayer());
  const activeRun = useRef<string | undefined>(undefined);
  const terminalRuns = useRef(new Set<string>());
  const textSequences = useRef(new Map<string, number>());
  const previousRealtimeStatus = useRef(service.getRealtimeStatus());
  const [realtimeStatus, setRealtimeStatus] = useState(
    service.getRealtimeStatus(),
  );
  const applySnapshot = useCallback(
    async (onlyActiveRun = false) => {
      const snapshot = await service.getSnapshot(agent.conversationId);
      if (
        onlyActiveRun &&
        activeRun.current &&
        snapshot.run?.id !== activeRun.current
      )
        return;
      setView(snapshot.state.view);
      setOfflineReadOnly(snapshot.cached);
      setTemporaryText({});
      const run = snapshot.run;
      setHasStarted(isPrimeWorldStarted(snapshot.state, run));
      if (run?.status === "queued" || run?.status === "running") {
        activeRun.current = run.id;
        setBusy(true);
        return;
      }
      const audio = [...(snapshot.resources ?? [])]
        .reverse()
        .find((resource) => resource.mimeType.startsWith("audio/"));
      if (audio && player.current.requiresFullResource())
        void service
          .resolveAudioResource(audio.resourceId)
          .then((url) => player.current.complete(url));
      activeRun.current = undefined;
      setBusy(false);
      if (run?.status === "failed")
        setError(run.errorDetail ?? run.errorCode ?? "世界运行失败。");
      if (run?.status === "cancelled") player.current.stop();
    },
    [agent.conversationId, service],
  );
  useEffect(() => {
    void applySnapshot().catch(() => undefined);
  }, [applySnapshot]);
  useEffect(() => {
    let disposed = false;
    void service
      .resolveViewResources(view)
      .then((urls) => {
        if (disposed) {
          urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        setResourceUrls((current) => {
          current.forEach((url) => URL.revokeObjectURL(url));
          return urls;
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [service, view]);
  useEffect(
    () => () => {
      resourceUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [resourceUrls],
  );
  useEffect(() => service.subscribeStatus(setRealtimeStatus), [service]);
  useEffect(() => {
    const previous = previousRealtimeStatus.current;
    previousRealtimeStatus.current = realtimeStatus;
    if (busy && previous !== "live" && realtimeStatus === "live")
      void applySnapshot(true).catch(() => undefined);
  }, [applySnapshot, busy, realtimeStatus]);
  useEffect(
    () =>
      service.subscribe(
        (event) => {
          if (event.conversationId !== agent.conversationId) return;
          if (event.type === "world.run.started") {
            terminalRuns.current.delete(event.runId);
            activeRun.current = event.runId;
            setBusy(true);
            setHasStarted(true);
            setTemporaryText({});
            textSequences.current.clear();
            player.current.stop();
          } else if (event.runId !== activeRun.current) {
            return;
          } else if (event.type === "world.view.text_delta") {
            const expected = textSequences.current.get(event.nodeId) ?? 0;
            if (event.sequence !== expected) {
              setTemporaryText({});
              void applySnapshot(true).catch(() => undefined);
              return;
            }
            textSequences.current.set(event.nodeId, expected + 1);
            setTemporaryText((current) => ({
              ...current,
              [event.elementId]: `${current[event.elementId] ?? ""}${event.delta}`,
            }));
          } else if (event.type === "world.view.committed") {
            setView(event.view);
            setTemporaryText({});
            void service.cacheCommittedView(
              agent.conversationId,
              event.view,
              event.stateVersion,
            );
          } else if (event.type === "world.audio.started") {
            player.current.start(event.mimeType);
          } else if (event.type === "world.audio.completed") {
            void (async () => {
              const fallbackUrl =
                event.resourceId && player.current.requiresFullResource()
                  ? await service.resolveAudioResource(event.resourceId)
                  : undefined;
              const receivedBlob = await player.current.complete(fallbackUrl);
              if (event.resourceId && receivedBlob)
                void service.cacheAudioResource(event.resourceId, receivedBlob);
            })();
          } else if (event.type === "world.audio.failed") {
            player.current.stop();
          } else if (event.type === "world.run.completed") {
            terminalRuns.current.add(event.runId);
            setBusy(false);
            activeRun.current = undefined;
          } else if (
            event.type === "world.run.cancelled" ||
            event.type === "world.run.failed"
          ) {
            terminalRuns.current.add(event.runId);
            setBusy(false);
            activeRun.current = undefined;
            setTemporaryText({});
            player.current.stop();
            if (event.type === "world.run.failed")
              setError(event.message ?? "世界运行失败。");
            void applySnapshot(true).catch(() => undefined);
          }
        },
        (event) => {
          if (
            event.conversationId !== agent.conversationId ||
            event.runId !== activeRun.current
          )
            return;
          player.current.append(event.sequence, event.data);
        },
      ),
    [agent.conversationId, applySnapshot, service],
  );
  useEffect(() => () => player.current.stop(), []);
  useEffect(() => {
    if (!editing) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => {
      window.document.body.style.overflow = previousOverflow;
    };
  }, [editing]);
  useEffect(() => {
    if (!busy) return;
    if (realtimeStatus === "live") {
      const timeout = window.setTimeout(
        () => void applySnapshot(true).catch(() => undefined),
        35_000,
      );
      return () => window.clearTimeout(timeout);
    }
    void applySnapshot(true).catch(() => undefined);
    const timer = window.setInterval(
      () => void applySnapshot(true).catch(() => undefined),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [applySnapshot, busy, realtimeStatus]);
  const dispatch = async (
    type: "world.start" | "ui.action" | "input.text",
    payload: JsonObject = {},
  ) => {
    setBusy(true);
    setError(null);
    try {
      const run = await service.dispatch(agent.conversationId, {
        clientEventId: crypto.randomUUID(),
        type,
        payload,
        expectedViewRevision: view.revision,
        interruptCurrent: type !== "world.start",
      });
      if (!terminalRuns.current.has(run.id)) {
        activeRun.current = run.id;
        setHasStarted(true);
      }
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界运行失败。");
      setBusy(false);
    }
  };
  const submitText = () => {
    const text = input.trim();
    if (text && !busy) void dispatch("input.text", { text });
  };
  const deleteConversation = () => {
    if (isDeletingConversation) return;
    void requestPrimeWorldConversationDeletion({
      conversationId: agent.conversationId,
      onDelete,
      confirmDeletion: (message) => window.confirm(message),
      onDeletingChange: setIsDeletingConversation,
      onError: setError,
    });
  };
  const resetConversation = () => {
    if (busy) return;
    void requestPrimeWorldConversationReset({
      conversationId: agent.conversationId,
      onReset: (conversationId) => service.reset(conversationId),
      confirmReset: (message) => window.confirm(message),
      onResettingChange: setBusy,
      onError: setError,
    }).then((runId) => {
      if (!runId) return;
      if (!terminalRuns.current.has(runId)) {
        activeRun.current = runId;
        setHasStarted(true);
      }
    });
  };
  const pushToTalk = usePushToTalk({
    disabled: false,
    maxRecordingSeconds: 120,
    onError: setError,
    onRecorded: async (blob) => {
      setBusy(true);
      try {
        const resourceId = await service.uploadVoice(blob);
        const run = await service.dispatch(agent.conversationId, {
          clientEventId: crypto.randomUUID(),
          type: "input.voice",
          payload: { resourceId },
          expectedViewRevision: view.revision,
          interruptCurrent: true,
        });
        if (!terminalRuns.current.has(run.id)) activeRun.current = run.id;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "世界运行失败。");
        setBusy(false);
      }
    },
  });
  return (
    <section className="mx-auto flex h-full min-h-0 max-w-5xl flex-col gap-5 pb-4 md:py-8">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-0 md:pb-4 md:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <BackButton label="返回会话" onClick={onBack} />
          <ConversationHeaderTitle
            title={agent.name}
            subtitle="本初世界"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PrimeWorldDeleteButton
            disabled={isDeletingConversation}
            onClick={deleteConversation}
          />
          <button
            className="hidden h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 md:grid"
            title="编辑定义"
            disabled={offlineReadOnly}
            onClick={() => setEditing((value) => !value)}
          >
            <SlidersHorizontal size={18} />
          </button>
          {hasStarted === false ? (
            <button
              className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50"
              disabled={busy || offlineReadOnly}
              onClick={() => void dispatch("world.start")}
            >
              <Play size={15} weight="fill" />
              开始
            </button>
          ) : hasStarted ? (
            <button
              className="flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-medium text-white/75 transition hover:bg-white/10 disabled:opacity-50"
              disabled={busy || offlineReadOnly}
              title="清除当前进度并重新开始"
              onClick={resetConversation}
            >
              <ArrowCounterClockwise size={16} />
              重新开始
            </button>
          ) : null}
        </div>
      </header>
      {editing ? (
        createPortal(
          <div
            className="app-overlay app-overlay-fullscreen fixed inset-0 h-[100dvh] w-[100dvw] bg-[#0b0b0d]"
            role="dialog"
            aria-modal="true"
            aria-label="世界工作流编辑器"
          >
            <PrimeWorldEditorPage
              detail={agent.detail}
              conversationId={agent.conversationId}
              service={service}
              onSave={onSave}
              onClose={() => setEditing(false)}
            />
          </div>,
          window.document.body,
        )
      ) : (
        <main
          className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]"
          style={{
            backgroundColor: view.background?.color,
            ...(view.background?.resourceId
              ? {
                  backgroundImage: `url(${resourceUrls.get(view.background.resourceId) ?? ""})`,
                  backgroundSize: "cover",
                }
              : {}),
          }}
        >
          {view.title ? (
            <div className="border-b border-white/10 px-5 py-3 text-sm font-medium text-white/75">
              {view.title}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 md:p-8">
            <WorldElement
              element={view.root}
              disabled={busy || offlineReadOnly}
              resourceUrls={resourceUrls}
              temporaryText={temporaryText}
              onAction={(actionId, payload) =>
                void dispatch("ui.action", { actionId, ...payload })
              }
            />
          </div>
          {view.input ? (
            <div className="flex gap-2 border-t border-white/10 p-4">
              {view.input.mode === "text" ||
              view.input.mode === "text-and-voice" ? (
                <>
                  <input
                    className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/35"
                    placeholder={view.input.placeholder ?? "输入行动..."}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitText();
                    }}
                    disabled={busy || offlineReadOnly}
                  />
                  <button
                    aria-label={view.input.submitLabel ?? "提交行动"}
                    className="grid h-11 min-w-11 place-items-center rounded-lg bg-white px-3 text-black disabled:opacity-50"
                    disabled={busy || offlineReadOnly || !input.trim()}
                    onClick={submitText}
                  >
                    <PaperPlaneRight size={18} weight="fill" />
                  </button>
                </>
              ) : null}
              {view.input.mode === "voice" ||
              view.input.mode === "text-and-voice" ? (
                <button
                  aria-label="按住录音，松开发送"
                  disabled={offlineReadOnly}
                  className={`grid h-11 min-w-11 place-items-center rounded-lg border ${pushToTalk.phase === "recording" ? "border-red-300 bg-red-400/20 text-red-200" : "border-white/10 bg-white/[.06] text-white/70"}`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (activeRun.current) {
                      player.current.stop();
                      void service.cancel(
                        agent.conversationId,
                        activeRun.current,
                      );
                    }
                    void pushToTalk.beginHold(event.clientY);
                  }}
                  onPointerMove={(event) => pushToTalk.moveHold(event.clientY)}
                  onPointerUp={pushToTalk.endHold}
                  onPointerCancel={pushToTalk.cancel}
                >
                  <Microphone
                    size={18}
                    weight={
                      pushToTalk.phase === "recording" ? "fill" : "regular"
                    }
                  />
                </button>
              ) : null}
            </div>
          ) : null}
        </main>
      )}
      {busy ? <p className="text-sm text-white/45">世界正在推进…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export const PRIME_WORLD_DELETE_CONFIRMATION =
  "确定要删除这个会话吗？会话与消息将从服务器永久删除。";

export const PRIME_WORLD_RESET_CONFIRMATION =
  "重新开始会清除当前世界的剧情进度、历史记录和定时事件。确定继续吗？";

export function isPrimeWorldStarted(
  state: Pick<PrimeWorldRuntimeState, "startedAt">,
  run?: Pick<PrimeWorldRun, "status">,
) {
  return (
    state.startedAt !== undefined ||
    run?.status === "queued" ||
    run?.status === "running"
  );
}

export async function requestPrimeWorldConversationReset(input: {
  conversationId: string;
  onReset: (conversationId: string) => Promise<{ runId: string }>;
  confirmReset: (message: string) => boolean;
  onResettingChange: (resetting: boolean) => void;
  onError: (message: string | null) => void;
}) {
  if (!input.confirmReset(PRIME_WORLD_RESET_CONFIRMATION)) return null;
  input.onError(null);
  input.onResettingChange(true);
  try {
    const reset = await input.onReset(input.conversationId);
    return reset.runId;
  } catch (error) {
    input.onError(error instanceof Error ? error.message : "重新开始失败。");
    input.onResettingChange(false);
    return null;
  }
}

export async function requestPrimeWorldConversationDeletion(input: {
  conversationId: string;
  onDelete: (conversationId: string) => Promise<void>;
  confirmDeletion: (message: string) => boolean;
  onDeletingChange: (deleting: boolean) => void;
  onError: (message: string | null) => void;
}) {
  if (!input.confirmDeletion(PRIME_WORLD_DELETE_CONFIRMATION)) return false;
  input.onError(null);
  input.onDeletingChange(true);
  try {
    await input.onDelete(input.conversationId);
    return true;
  } catch (error) {
    input.onError(error instanceof Error ? error.message : "删除会话失败。");
    return false;
  } finally {
    input.onDeletingChange(false);
  }
}

export function PrimeWorldDeleteButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label="删除会话"
      className="grid h-9 w-9 place-items-center rounded-lg text-red-200/75 transition hover:bg-red-400/10 hover:text-red-100 disabled:opacity-40"
      disabled={disabled}
      title="删除会话"
      type="button"
      onClick={onClick}
    >
      <Trash size={18} />
    </button>
  );
}

function WorldElement({
  element,
  disabled,
  onAction,
  resourceUrls,
  temporaryText,
}: {
  element: WorldViewElement;
  disabled: boolean;
  onAction: (actionId: string, payload: JsonObject) => void;
  resourceUrls: Map<string, string>;
  temporaryText: Record<string, string>;
}): ReactNode {
  if (element.type === "text")
    return (
      <p
        className={`whitespace-pre-wrap ${element.tone === "title" ? "text-2xl font-semibold leading-tight text-white" : element.tone === "muted" ? "text-sm leading-6 text-white/50" : "text-[15px] leading-7 text-white/90"}`}
      >
        {temporaryText[element.id] ?? element.text}
      </p>
    );
  if (element.type === "divider") return <hr className="border-white/10" />;
  if (element.type === "image")
    return (
      <img
        className="max-h-[28rem] w-full rounded-lg object-cover"
        src={resourceUrls.get(element.resourceId)}
        alt={element.alt ?? ""}
      />
    );
  if (element.type === "progress")
    return (
      <div>
        <div className="mb-2 flex justify-between text-xs text-white/55">
          <span>{element.label ?? "进度"}</span>
          <span>
            {element.value}/{element.max}
          </span>
        </div>
        <progress
          className="h-2 w-full accent-violet-500"
          max={element.max}
          value={Math.min(element.value, element.max)}
        />
      </div>
    );
  if (element.type === "choices")
    return (
      <div className="grid gap-2">
        {element.choices.map((choice) => (
          <button
            key={choice.id}
            className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-3 text-left transition hover:bg-white/[0.12] disabled:opacity-45"
            disabled={disabled}
            onClick={() =>
              onAction(element.actionId, {
                choiceId: choice.id,
                ...(choice.payload ?? {}),
              })
            }
          >
            <span className="block text-sm font-medium text-white">
              {choice.label}
            </span>
            {choice.description ? (
              <span className="mt-1 block text-xs leading-5 text-white/45">
                {choice.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  return (
    <div
      className={
        element.direction === "horizontal"
          ? "flex flex-wrap gap-3"
          : "space-y-4"
      }
    >
      {element.children.map((child) => (
        <WorldElement
          key={child.id}
          element={child}
          disabled={disabled}
          onAction={onAction}
          resourceUrls={resourceUrls}
          temporaryText={temporaryText}
        />
      ))}
    </div>
  );
}
