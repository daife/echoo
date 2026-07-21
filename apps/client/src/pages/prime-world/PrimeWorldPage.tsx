import type {
  JsonObject,
  PrimeWorldAgent,
  WorldView,
  WorldViewElement,
} from "@echoo/shared";
import {
  ArrowLeft,
  PaperPlaneRight,
  Play,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type { PrimeWorldService } from "../../services/PrimeWorldService";
import { PrimeWorldEditorPage } from "./PrimeWorldEditorPage";

export function PrimeWorldPage({
  agent,
  service,
  onBack,
  onSave,
}: {
  agent: PrimeWorldAgent;
  service: PrimeWorldService;
  onBack: () => void;
  onSave: (detail: PrimeWorldAgent["detail"]) => Promise<void>;
}) {
  const [view, setView] = useState<WorldView>(
    agent.detail.presentation.startView,
  );
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    void service
      .getSnapshot(agent.conversationId)
      .then((snapshot) => setView(snapshot.state.view))
      .catch(() => undefined);
  }, [agent.conversationId, service]);
  const dispatch = async (
    type: "world.start" | "ui.action" | "input.text",
    payload: JsonObject = {},
  ) => {
    setBusy(true);
    setError(null);
    try {
      await service.dispatch(agent.conversationId, {
        clientEventId: crypto.randomUUID(),
        type,
        payload,
        expectedViewRevision: view.revision,
      });
      const snapshot = await service.getSnapshot(agent.conversationId);
      setView(snapshot.state.view);
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界运行失败。");
    } finally {
      setBusy(false);
    }
  };
  const submitText = () => {
    const text = input.trim();
    if (text && !busy) void dispatch("input.text", { text });
  };
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-5xl flex-col gap-5 py-4 md:py-8">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <button
            aria-label="返回会话"
            className="grid h-9 w-9 place-items-center rounded-lg text-white/65 hover:bg-white/10"
            onClick={onBack}
          >
            <ArrowLeft size={19} />
          </button>
          <div>
            <p className="text-xs text-white/45">本初世界</p>
            <h1 className="text-xl font-semibold text-white">{agent.name}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10"
            title="编辑定义"
            onClick={() => setEditing((value) => !value)}
          >
            <SlidersHorizontal size={18} />
          </button>
          <button
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50"
            disabled={busy}
            onClick={() => void dispatch("world.start")}
          >
            <Play size={15} weight="fill" />
            开始
          </button>
        </div>
      </header>
      {editing ? (
        <PrimeWorldEditorPage
          detail={agent.detail}
          service={service}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      ) : (
        <main
          className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]"
          style={{ backgroundColor: view.background?.color }}
        >
          {view.title ? (
            <div className="border-b border-white/10 px-5 py-3 text-sm font-medium text-white/75">
              {view.title}
            </div>
          ) : null}
          <div className="flex-1 p-5 md:p-8">
            <WorldElement
              element={view.root}
              disabled={busy}
              onAction={(actionId, payload) =>
                void dispatch("ui.action", { actionId, ...payload })
              }
            />
          </div>
          {view.input?.mode === "text" ||
          view.input?.mode === "text-and-voice" ? (
            <div className="flex gap-2 border-t border-white/10 p-4">
              <input
                className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/35"
                placeholder={view.input.placeholder ?? "输入行动..."}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitText();
                }}
                disabled={busy}
              />
              <button
                aria-label={view.input.submitLabel ?? "提交行动"}
                className="grid h-11 min-w-11 place-items-center rounded-lg bg-white px-3 text-black disabled:opacity-50"
                disabled={busy || !input.trim()}
                onClick={submitText}
              >
                <PaperPlaneRight size={18} weight="fill" />
              </button>
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

function WorldElement({
  element,
  disabled,
  onAction,
}: {
  element: WorldViewElement;
  disabled: boolean;
  onAction: (actionId: string, payload: JsonObject) => void;
}): ReactNode {
  if (element.type === "text")
    return (
      <p
        className={`whitespace-pre-wrap ${element.tone === "title" ? "text-2xl font-semibold leading-tight text-white" : element.tone === "muted" ? "text-sm leading-6 text-white/50" : "text-[15px] leading-7 text-white/90"}`}
      >
        {element.text}
      </p>
    );
  if (element.type === "divider") return <hr className="border-white/10" />;
  if (element.type === "image")
    return (
      <img
        className="max-h-[28rem] w-full rounded-lg object-cover"
        src={element.resourceUrl}
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
        />
      ))}
    </div>
  );
}
