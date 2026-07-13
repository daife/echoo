import {
  PaperPlaneRight,
  PencilSimple,
  Trash,
  Waveform,
  X,
} from "@phosphor-icons/react";
import {
  buildFigureSystemPrompt,
  type Agent,
  type AgentAttribute,
  type LocalMessage,
  type SliceFigureAgent,
  type UpdateSliceFigureRequest,
} from "@echoo/shared";
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import {
  MessageBubble,
  type MessageBubbleModel,
} from "../../features/messages/components/MessageBubble";
import {
  formatConversationTime,
  isVisibleConversationMessage,
  getConversationPresenceLabel,
  shouldShowMessageTime,
} from "../../features/messages/messagePresentation";
import { useConversationMessages } from "./useConversationMessages";

export type UpdateAgentHandlers = {
  "slice-figure": (
    agentId: string,
    input: UpdateSliceFigureRequest,
  ) => Promise<Agent>;
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
    error,
    canRollback,
    sendMessage,
    loadOlderMessages,
    retryFailedMessage,
    deleteConversation,
    rollbackConversation,
  } = useConversationMessages({ agent, onConversationDeleted });
  const mainRef = useRef<HTMLElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFollowBottomRef = useRef(true);
  const lastConversationRef = useRef<string | undefined>(undefined);
  const lastVisibleMessageIdRef = useRef<string | undefined>(undefined);
  const lastScrollTopRef = useRef(0);
  const title = agent?.name ?? "选择一个角色";
  const subtitle = agent
    ? getConversationPresenceLabel({
        agentTypeLabel: formatAgentType(agent),
        isAgentActive,
        isAgentMuted,
      })
    : "打开或创建一个角色以开始聊天";
  const prologueHtml =
    agent?.type === "slice-figure" || agent?.type === "prime-figure"
      ? agent.detail.prologueHtml
      : "";
  const editor = agent ? getAgentEditor(agent, updateHandlers) : null;
  const conversationId = agent?.conversationId;

  const visibleMessages = useMemo(() => {
    if (!agent) return [];
    const visible = messages.filter(isVisibleConversationMessage);
    if (visible.length > 0)
      return visible.map((message) => toBubbleMessage(message, canRollback));
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
        <div className="flex items-center gap-1">
          {editor ? (
            <button
              aria-label="编辑角色"
              className="grid h-9 w-9 place-items-center rounded-lg text-white/45 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white active:translate-y-px"
              type="button"
              onClick={() => {
                setEditError(null);
                setIsEditOpen(true);
              }}
            >
              <PencilSimple size={17} />
            </button>
          ) : null}
          <button
            aria-label="删除会话"
            className="grid h-9 w-9 place-items-center rounded-lg text-white/35 transition hover:bg-red-400/10 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300 active:translate-y-px disabled:opacity-40"
            disabled={isDeletingConversation}
            type="button"
            onClick={deleteConversation}
          >
            <Trash size={17} />
          </button>
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
        <div className="flex flex-col gap-5">
          {visibleMessages.map((message, index) => {
            const previous = visibleMessages[index - 1];
            const showTime = shouldShowMessageTime(
              message.createdAt,
              previous?.createdAt,
            );
            return (
              <Fragment key={message.id}>
                {showTime && message.createdAt > 0 ? (
                  <div className="self-center text-[11px] tabular-nums text-white/32">
                    {formatConversationTime(message.createdAt)}
                  </div>
                ) : null}
                <MessageBubble
                  message={message}
                  onRetry={retryFailedMessage}
                  onRollback={canRollback ? rollbackConversation : undefined}
                />
              </Fragment>
            );
          })}
        </div>
        {error ? (
          <div className="self-center rounded-full border border-red-400/20 px-4 py-2 text-xs text-red-200/80">
            {error}
          </div>
        ) : null}
      </main>

      <footer className="relative px-4 pb-4 pt-2 md:px-6 md:pb-6">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-[#0d0d10] to-transparent" />
        <form
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#121216] p-2 shadow-[0_14px_38px_rgba(0,0,0,0.22)] transition focus-within:border-white/30"
          onSubmit={(event) => {
            void sendMessage(event);
            window.requestAnimationFrame(() =>
              messageInputRef.current?.focus(),
            );
          }}
        >
          <input
            ref={messageInputRef}
            aria-label={`给 ${title} 发消息`}
            className="min-w-0 flex-1 border-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/32"
            placeholder="写下消息，Enter 发送"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            aria-label="发送消息"
            className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[#09090b] transition hover:bg-white/88 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!draft.trim() || isSending}
            type="submit"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </form>
      </footer>
      {isEditOpen && editor
        ? editor.renderDialog({
            error: editError,
            isSubmitting: isUpdatingAgent,
            user,
            onClose: () => {
              if (isUpdatingAgent) return;
              setIsEditOpen(false);
              setEditError(null);
            },
            onSubmit: async (payload) => {
              setIsUpdatingAgent(true);
              setEditError(null);
              try {
                await editor.update(payload);
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
            },
          })
        : null}
    </section>
  );
}

type AgentEditor = {
  actionLabel: string;
  actionDescription: string;
  update: (payload: UpdateSliceFigureRequest) => Promise<Agent>;
  renderDialog: (props: {
    user: { displayName: string } | null;
    isSubmitting: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (payload: UpdateSliceFigureRequest) => Promise<void>;
  }) => React.ReactNode;
};

function getAgentEditor(
  agent: Agent,
  updateHandlers: UpdateAgentHandlers,
): AgentEditor | null {
  if (agent.type !== "slice-figure") return null;

  return {
    actionLabel: "修改切片角色",
    actionDescription: "修改姓名、人设、情景、属性和标签。",
    update: (payload) => updateHandlers["slice-figure"](agent.id, payload),
    renderDialog: (props) => <EditSliceFigureDialog agent={agent} {...props} />,
  };
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
  const [form, setForm] = useState<UpdateSliceFigureRequest>(() =>
    agentToUpdateForm(agent),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);

  const updateField = (
    key: keyof UpdateSliceFigureRequest,
    value: UpdateSliceFigureRequest[keyof UpdateSliceFigureRequest],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLocalError(null);
    setPromptPreview(null);
  };

  const updateAttribute = (
    index: number,
    key: keyof AgentAttribute,
    value: string,
  ) => {
    const attributes = [...(form.attributes ?? [])];
    attributes[index] = {
      ...(attributes[index] ?? { key: "", value: "" }),
      [key]: value,
    };
    updateField("attributes", attributes);
  };

  const removeAttribute = (index: number) => {
    updateField(
      "attributes",
      (form.attributes ?? []).filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const updateTag = (index: number, value: string) => {
    const tags = [...(form.tags ?? [])];
    tags[index] = value;
    updateField("tags", tags);
  };

  const removeTag = (index: number) => {
    updateField(
      "tags",
      (form.tags ?? []).filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const updateList = (key: "linkedAgentIds", value: string) => {
    updateField(
      key,
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = buildUpdatePayload(form);
    if (typeof payload === "string") {
      setLocalError(payload);
      return;
    }
    await onSubmit(payload);
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

        <div className="grid gap-4">
          <TextField
            label="名字"
            required
            value={form.name}
            onChange={(value) => updateField("name", value)}
          />
          <TextField
            label="人设"
            required
            multiline
            value={form.persona}
            onChange={(value) => updateField("persona", value)}
          />
          <TextField
            label="背景"
            required
            multiline
            value={form.background}
            onChange={(value) => updateField("background", value)}
          />
          <TextField
            label="性格"
            required
            multiline
            value={form.personality}
            onChange={(value) => updateField("personality", value)}
          />
          <TextField
            label="回复风格"
            required
            multiline
            value={form.responseStyle}
            onChange={(value) => updateField("responseStyle", value)}
          />
          <TextField
            label="系统提示词模板"
            required
            multiline
            mono
            value={form.systemPrompt}
            onChange={(value) => updateField("systemPrompt", value)}
          />
          <TextField
            label="介绍"
            multiline
            value={form.introduction ?? ""}
            onChange={(value) => updateField("introduction", value)}
          />
          <TextField
            label="叙引（HTML，可选）"
            multiline
            mono
            value={form.prologueHtml ?? ""}
            onChange={(value) => updateField("prologueHtml", value)}
          />
          <TextField
            label="当前情景（可选）"
            multiline
            value={form.currentSituation ?? ""}
            onChange={(value) => updateField("currentSituation", value)}
          />
          <TextField
            label="开场白（可选）"
            multiline
            value={form.openingLine ?? ""}
            onChange={(value) => updateField("openingLine", value)}
          />
          <TextField
            label="链接的角色 ID（逗号分隔）"
            value={(form.linkedAgentIds ?? []).join(", ")}
            onChange={(value) => updateList("linkedAgentIds", value)}
          />

          <EditablePairs
            items={form.attributes ?? []}
            onAdd={() =>
              updateField("attributes", [
                ...(form.attributes ?? []),
                { key: "", value: "" },
              ])
            }
            onRemove={removeAttribute}
            onUpdate={updateAttribute}
          />

          <EditableTags
            tags={form.tags ?? []}
            onAdd={() => updateField("tags", [...(form.tags ?? []), ""])}
            onRemove={removeTag}
            onUpdate={updateTag}
          />

          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <span>
              <span className="block text-sm font-medium text-white/78">
                是否公开
              </span>
              <span className="mt-1 block text-xs text-white/40">
                公开后可用于未来的探索页和分享场景。
              </span>
            </span>
            <input
              checked={form.isPublic}
              type="checkbox"
              onChange={(event) =>
                updateField("isPublic", event.target.checked)
              }
            />
          </label>
        </div>

        <div className="mt-5">
          <p className="mb-3 text-xs leading-5 text-white/38">
            可用：{"{{user.name}}"}、{"{{figure.persona}}"}、
            {"{{figure.background}}"}、{"{{figure.personality}}"}、
            {"{{figure.responseStyle}}"}、{"{{figure.currentSituation}}"}
            。不提供用户 ID、邮箱等字段。
          </p>
          <button
            className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 transition hover:border-white/25 hover:text-white"
            type="button"
            onClick={() =>
              setPromptPreview(buildFigureSystemPrompt(form, { user }))
            }
          >
            预览提示词
          </button>
          {promptPreview ? (
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/25 p-4 text-xs leading-5 text-white/65">
              {promptPreview}
            </pre>
          ) : null}
        </div>

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

function TextField({
  label,
  value,
  required,
  multiline,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  multiline?: boolean;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/78">
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea
          className={`mt-2 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25 ${mono ? "font-mono text-xs leading-5" : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function EditablePairs({
  items,
  onAdd,
  onRemove,
  onUpdate,
}: {
  items: AgentAttribute[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, key: keyof AgentAttribute, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-white/78">属性</span>
          <p className="mt-1 text-xs text-white/35">
            用于卡片内部右上角标注，不进入系统提示词。
          </p>
        </div>
        <button
          className="text-sm text-white/55 hover:text-white"
          type="button"
          onClick={onAdd}
        >
          添加
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        {items.map((attribute, index) => (
          <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              value={attribute.key}
              placeholder="年龄"
              onChange={(event) => onUpdate(index, "key", event.target.value)}
            />
            <input
              className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              value={attribute.value}
              placeholder="19"
              onChange={(event) => onUpdate(index, "value", event.target.value)}
            />
            <button
              aria-label="删除属性"
              className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
              type="button"
              onClick={() => onRemove(index)}
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditableTags({
  tags,
  onAdd,
  onRemove,
  onUpdate,
}: {
  tags: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-white/78">标签</span>
          <p className="mt-1 text-xs text-white/35">
            用于卡片底部标注，不进入系统提示词。
          </p>
        </div>
        <button
          className="text-sm text-white/55 hover:text-white"
          type="button"
          onClick={onAdd}
        >
          添加
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        {tags.map((tag, index) => (
          <div key={index} className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              value={tag}
              placeholder="陪伴"
              onChange={(event) => onUpdate(index, event.target.value)}
            />
            <button
              aria-label="删除标签"
              className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
              type="button"
              onClick={() => onRemove(index)}
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
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
  };
}

function formatAgentType(agent: Agent) {
  if (agent.type === "slice-figure") return "切片角色";
  if (agent.type === "prime-world") return "本初世界";
  return "本初角色";
}

function buildUpdatePayload(
  form: UpdateSliceFigureRequest,
): UpdateSliceFigureRequest | string {
  const requiredText = {
    name: form.name.trim(),
    persona: form.persona.trim(),
    background: form.background.trim(),
    personality: form.personality.trim(),
    responseStyle: form.responseStyle.trim(),
    systemPrompt: form.systemPrompt.trim(),
  };

  if (!requiredText.name) return "名字不能为空。";
  if (!requiredText.persona) return "人设不能为空。";
  if (!requiredText.background) return "背景不能为空。";
  if (!requiredText.personality) return "性格不能为空。";
  if (!requiredText.responseStyle) return "回复风格不能为空。";
  if (!requiredText.systemPrompt) return "系统提示词不能为空。";

  const attributes = (form.attributes ?? []).map((attribute) => ({
    key: typeof attribute.key === "string" ? attribute.key.trim() : "",
    value: typeof attribute.value === "string" ? attribute.value.trim() : "",
  }));
  if (attributes.some((attribute) => !attribute.key || !attribute.value))
    return "属性不能包含空键或空值，请补全或删除该属性。";

  const tags = (form.tags ?? []).map((tag) =>
    typeof tag === "string" ? tag.trim() : "",
  );
  if (tags.some((tag) => !tag)) return "标签不能包含空值，请补全或删除该标签。";

  const linkedAgentIds = (form.linkedAgentIds ?? []).map((agentId) =>
    typeof agentId === "string" ? agentId.trim() : "",
  );
  if (linkedAgentIds.some((agentId) => !agentId))
    return "链接的角色 ID 不能包含空值。";

  return {
    ...form,
    ...requiredText,
    introduction: form.introduction?.trim() ?? "",
    prologueHtml: form.prologueHtml?.trim() ?? "",
    currentSituation: form.currentSituation?.trim() ?? "",
    openingLine: form.openingLine?.trim() ?? "",
    attributes,
    tags,
    linkedAgentIds,
  };
}

function toBubbleMessage(
  message: LocalMessage,
  canRollback: boolean,
): MessageBubbleModel {
  return {
    id: message.id,
    from: message.role === "user" ? "me" : "agent",
    text: message.contentType === "text" ? (message.content.text ?? "") : "",
    createdAt: message.createdAt,
    deliveryState:
      message.syncStatus === "pending"
        ? "sending"
        : message.role === "user" && message.status === "failed"
          ? "failed"
          : undefined,
    kind:
      message.contentType === "voice"
        ? "voice"
        : message.contentType === "image"
          ? "image"
          : "text",
    mediaUrl: message.content.mediaUrl,
    transcript:
      message.contentType === "voice" ? message.content.text : undefined,
    durationSeconds:
      message.contentType === "voice"
        ? getVoiceDurationSeconds(message.metadata)
        : undefined,
    canRollback,
  };
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
