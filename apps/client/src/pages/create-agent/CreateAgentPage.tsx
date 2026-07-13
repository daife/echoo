import {
  Brain,
  CirclesThreePlus,
  Plus,
  Sparkle,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  buildFigureSystemPrompt,
  DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
  DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
  type Agent,
  type AgentAttribute,
  type AgentResourceUpload,
  type AgentType,
  type CreatePrimeFigureRequest,
  type CreateSliceFigureRequest,
  type PrimeFigureScheduleSegment,
  type PrimeFigureReferenceImage,
  type PrimeFigureReferenceImageInput,
  type PrimeFigureVariableDefinition,
  type PrimeFigureVariableType,
} from "@echoo/shared";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";

export type CreateAgentHandlers = {
  "slice-figure": (input: CreateSliceFigureRequest) => Promise<Agent>;
  "prime-figure": (input: CreatePrimeFigureRequest) => Promise<Agent>;
};

const createOptions = [
  {
    type: "prime-figure",
    label: "本初角色",
    title: "创建本初角色",
    description: "持续人格、带时间的记忆和情绪、日程感知，以及创作者定义的结构化状态。",
    icon: Brain,
  },
  {
    type: "slice-figure",
    label: "切片角色",
    title: "创建切片角色",
    description: "适合短场景、轻量人格、快速试验和临时任务。",
    icon: CirclesThreePlus,
  },
  {
    type: "prime-world",
    label: "本初世界",
    title: "本初世界（稍后推出）",
    description: "世界状态、规则推进和多主体事件会走完全独立的创建与运行时流程。",
    icon: Sparkle,
  },
] satisfies Array<{
  type: AgentType;
  label: string;
  title: string;
  description: string;
  icon: typeof Brain;
}>;

export function CreateAgentPage({ createHandlers }: { createHandlers: CreateAgentHandlers }) {
  const [selectedType, setSelectedType] = useState<AgentType>("slice-figure");

  return (
    <section className="space-y-8">
      <div className="glass-panel overflow-hidden rounded-2xl p-6 md:p-10">
        <div className="mb-5 flex items-center gap-3 text-sm text-white/50 md:mb-8">
          <Sparkle size={18} />
          共创智能体
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] text-white md:text-6xl">
          创造真正适合你的鲜活角色。
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">
          每种智能体都拥有独立的会话类型与运行时；共享展示数据，但不共享行为管线。
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="space-y-5">
          {createOptions.map((option) => {
            const Icon = option.icon;
            const active = selectedType === option.type;
            return (
              <button
                key={option.type}
                className={`glass-panel w-full rounded-2xl p-4 text-left transition active:scale-[0.99] md:p-6 ${
                  active ? "ring-1 ring-white/12" : "opacity-55 hover:opacity-80"
                }`}
                type="button"
                onClick={() => setSelectedType(option.type)}
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white md:h-14 md:w-14">
                    <Icon className="h-5 w-5 md:h-7 md:w-7" weight="duotone" />
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs ${active ? "bg-white font-semibold text-[#09090b]" : "border border-white/10 text-white/45"}`}>
                    {option.type === "prime-world" ? `${option.label}（稍后推出）` : option.label}
                  </span>
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white md:mt-8 md:text-3xl">{option.title}</h2>
                <p className="mt-3 hidden text-sm leading-6 text-white/52 md:block">{option.description}</p>
              </button>
            );
          })}
        </div>

        {selectedType === "slice-figure" ? (
          <SliceFigureCreateForm onCreate={createHandlers["slice-figure"]} />
        ) : selectedType === "prime-figure" ? (
          <PrimeFigureCreateForm onCreate={createHandlers["prime-figure"]} />
        ) : (
          <UnavailableCreatePanel />
        )}
      </div>
    </section>
  );
}

const initialSliceForm: CreateSliceFigureRequest = {
  type: "slice-figure",
  name: "",
  attributes: [],
  tags: [],
  introduction: "",
  prologueHtml: "",
  linkedAgentIds: [],
  unlockConditions: null,
  isPublic: false,
  persona: "",
  background: "",
  personality: "",
  responseStyle: "",
  currentSituation: "",
  openingLine: "",
  systemPrompt: DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
  memorySummaryPrompt: DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
  replyAutoSegment: false,
};

function SliceFigureCreateForm({ onCreate }: { onCreate: (input: CreateSliceFigureRequest) => Promise<Agent> }) {
  const { user } = useAuth();
  const [form, setForm] = useState<CreateSliceFigureRequest>(initialSliceForm);
  const [jsonInput, setJsonInput] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = <K extends keyof CreateSliceFigureRequest>(key: K, value: CreateSliceFigureRequest[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setPromptPreview(null);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as Partial<CreateSliceFigureRequest>;
      const next = {
        ...initialSliceForm,
        ...parsed,
        type: "slice-figure" as const,
        attributes: parsed.attributes ?? [],
        tags: parsed.tags ?? [],
        linkedAgentIds: parsed.linkedAgentIds ?? [],
        unlockConditions: parsed.unlockConditions ?? null,
        systemPrompt: parsed.systemPrompt ?? DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT,
        memorySummaryPrompt:
          parsed.memorySummaryPrompt ??
          DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT,
        isPublic: Boolean(parsed.isPublic),
      };
      setForm(next);
      setUnlockText(next.unlockConditions ? JSON.stringify(next.unlockConditions, null, 2) : "");
      setError(null);
      setPromptPreview(null);
    } catch {
      setError("JSON 无法解析，请检查格式。");
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = buildSlicePayload(form, unlockText);
    if (typeof result === "string") return setError(result);
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate(result);
      setForm(initialSliceForm);
      setJsonInput("");
      setUnlockText("");
      setPromptPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="glass-panel rounded-2xl p-6 md:p-8" onSubmit={submit}>
      <FormHeader icon={CirclesThreePlus} title="切片角色" description="展示信息不会进入模型上下文；下方人格与对话配置可由系统提示词模板引用。" />

      <SliceFigureFormFields
        form={form}
        jsonInput={jsonInput}
        unlockText={unlockText}
        promptPreview={promptPreview}
        user={user}
        onApplyJson={importJson}
        onJsonInputChange={setJsonInput}
        onPromptPreviewChange={setPromptPreview}
        onUnlockTextChange={setUnlockText}
        onChange={setField}
      />

      <SubmitState error={error} isSubmitting={isSubmitting} label="创建切片角色" />
    </form>
  );
}

export function SliceFigureFormFields({
  form,
  jsonInput,
  unlockText,
  promptPreview,
  user,
  existingAvatarUrl,
  existingCoverUrl,
  onApplyJson,
  onJsonInputChange,
  onUnlockTextChange,
  onPromptPreviewChange,
  onChange,
}: {
  form: CreateSliceFigureRequest;
  jsonInput: string;
  unlockText: string;
  promptPreview: string | null;
  user: { displayName: string } | null;
  existingAvatarUrl?: string;
  existingCoverUrl?: string;
  onApplyJson: () => void;
  onJsonInputChange: (value: string) => void;
  onUnlockTextChange: (value: string) => void;
  onPromptPreviewChange: (value: string | null) => void;
  onChange: <K extends keyof CreateSliceFigureRequest>(
    key: K,
    value: CreateSliceFigureRequest[K],
  ) => void;
}) {
  return (
    <>
      <JsonImport value={jsonInput} onChange={onJsonInputChange} onApply={onApplyJson} placeholder='{"type":"slice-figure","name":"Mira","systemPrompt":"你的人设：\\n{{figure.persona}}",...}' />
      <FormSection title="展示与关系数据 · 不进入上下文" description="仅用于界面展示、发现、序引或未来的关联与解锁能力。">
        <DisplayFields form={form} unlockText={unlockText} onUnlockTextChange={onUnlockTextChange} onChange={onChange} existingAvatarUrl={existingAvatarUrl} existingCoverUrl={existingCoverUrl} />
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <span><span className="block text-sm font-medium text-white/78">回复自动分段</span><span className="mt-1 block text-xs text-white/40">只改变气泡展示，不改变消息和对话轮数。</span></span>
          <input checked={Boolean(form.replyAutoSegment)} type="checkbox" onChange={(event) => onChange("replyAutoSegment", event.target.checked)} />
        </label>
      </FormSection>
      <FormSection title="人格与对话 · 进入上下文" description="带 * 的字段必填。系统提示词决定这些字段如何组织和发送给模型。">
        <TextField label="人设" required multiline value={form.persona} placeholder="角色是谁，与用户是什么关系" onChange={(value) => onChange("persona", value)} />
        <TextField label="背景" required multiline value={form.background} placeholder="经历、环境、世界观与任务背景" onChange={(value) => onChange("background", value)} />
        <TextField label="性格" required multiline value={form.personality} placeholder="偏好、边界、缺点和稳定行为模式" onChange={(value) => onChange("personality", value)} />
        <TextField label="回复风格" required multiline value={form.responseStyle} placeholder="语言长度、语气、动作表达和禁忌，图片发送习惯，语音发送习惯...示例回复..." onChange={(value) => onChange("responseStyle", value)} />
        <TextField label="当前情景" multiline value={form.currentSituation ?? ""} placeholder="可在模板中通过 {{figure.currentSituation}} 引用" onChange={(value) => onChange("currentSituation", value)} />
        <TextField label="开场白" multiline value={form.openingLine ?? ""} placeholder="作为首条助手消息写入会话，因此会进入对话历史" onChange={(value) => onChange("openingLine", value)} />
        <TextField label="系统提示词模板" required multiline mono value={form.systemPrompt} placeholder={DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT} onChange={(value) => onChange("systemPrompt", value)} />
        <TextField label="记忆总结提示词" required multiline mono value={form.memorySummaryPrompt ?? ""} placeholder={DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT} onChange={(value) => onChange("memorySummaryPrompt", value)} />
        <p className="text-xs leading-5 text-white/42">可用：{"{{user.name}}"}、{"{{figure.persona}}"}、{"{{figure.background}}"}、{"{{figure.personality}}"}、{"{{figure.responseStyle}}"}、{"{{figure.currentSituation}}"}。不提供用户 ID、邮箱等字段。</p>
        <button className="w-fit rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 transition hover:border-white/25 hover:text-white" type="button" onClick={() => onPromptPreviewChange(buildFigureSystemPrompt(form, { user }))}>预览解析后的完整系统提示词</button>
        {promptPreview !== null ? <PromptPreview value={promptPreview} /> : null}
      </FormSection>
    </>
  );
}

type PrimeVariableDraft = Omit<PrimeFigureVariableDefinition, "defaultValue"> & {
  defaultValueText: string;
};

export const initialPrimeForm = (): CreatePrimeFigureRequest => ({
  type: "prime-figure",
  name: "",
  attributes: [],
  tags: [],
  introduction: "",
  prologueHtml: "",
  linkedAgentIds: [],
  unlockConditions: null,
  isPublic: false,
  persona: "",
  background: "",
  personality: "",
  responseStyle: "",
  decisionStyle: "",
  currentSituation: "",
  schedule: {
    segments: [],
  },
  itinerary: "",
  variableDefinitions: [],
  referenceImages: [],
  voiceRequestStreaming: false,
  initialMood: "",
  initialRelationshipStatus: "",
});

const weekdays = [
  ["mon", "一"], ["tue", "二"], ["wed", "三"], ["thu", "四"],
  ["fri", "五"], ["sat", "六"], ["sun", "日"],
] as const;

function PrimeFigureCreateForm({ onCreate }: { onCreate: (input: CreatePrimeFigureRequest) => Promise<Agent> }) {
  return (
    <PrimeFigureForm
      mode="create"
      onSubmit={onCreate}
    />
  );
}

export function PrimeFigureForm({
  mode,
  initialForm: initialValue,
  existingAvatarUrl,
  existingCoverUrl,
  existingReferenceImages = [],
  externalError,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initialForm?: CreatePrimeFigureRequest;
  existingAvatarUrl?: string;
  existingCoverUrl?: string;
  existingReferenceImages?: PrimeFigureReferenceImage[];
  externalError?: string | null;
  onClose?: () => void;
  onSubmit: (input: CreatePrimeFigureRequest) => Promise<Agent | void>;
}) {
  const [form, setForm] = useState<CreatePrimeFigureRequest>(() =>
    initialValue ?? initialPrimeForm(),
  );
  const [variables, setVariables] = useState<PrimeVariableDraft[]>(() =>
    (initialValue?.variableDefinitions ?? []).map(variableToDraft),
  );
  const [unlockText, setUnlockText] = useState(() =>
    initialValue?.unlockConditions
      ? JSON.stringify(initialValue.unlockConditions, null, 2)
      : "",
  );
  const [jsonInput, setJsonInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = <K extends keyof CreatePrimeFigureRequest>(key: K, value: CreatePrimeFigureRequest[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as Partial<CreatePrimeFigureRequest>;
      const base = mode === "edit" ? form : initialPrimeForm();
      const next: CreatePrimeFigureRequest = {
        ...base,
        ...parsed,
        type: "prime-figure",
        attributes: parsed.attributes ?? base.attributes ?? [],
        tags: parsed.tags ?? base.tags ?? [],
        linkedAgentIds: parsed.linkedAgentIds ?? base.linkedAgentIds ?? [],
        unlockConditions:
          parsed.unlockConditions ?? base.unlockConditions ?? null,
        schedule: parsed.schedule ?? base.schedule ?? { segments: [] },
        variableDefinitions:
          parsed.variableDefinitions ?? base.variableDefinitions ?? [],
        referenceImages:
          parsed.referenceImages ?? base.referenceImages ?? [],
        isPublic:
          parsed.isPublic === undefined ? base.isPublic : Boolean(parsed.isPublic),
      };
      setForm(next);
      setVariables((next.variableDefinitions ?? []).map(variableToDraft));
      setUnlockText(next.unlockConditions ? JSON.stringify(next.unlockConditions, null, 2) : "");
      setError(null);
    } catch {
      setError("JSON 无法解析，请检查格式。");
    }
  };

  const updateSegment = (index: number, patch: Partial<PrimeFigureScheduleSegment>) => {
    const segments = [...(form.schedule?.segments ?? [])];
    segments[index] = { ...(segments[index] as PrimeFigureScheduleSegment), ...patch };
    setField("schedule", { segments });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = buildPrimePayload(form, variables, unlockText);
    if (typeof result === "string") return setError(result);
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `本初角色${mode === "create" ? "创建" : "修改"}失败，请稍后再试。`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="glass-panel rounded-2xl p-6 md:p-8" onSubmit={submit}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <FormHeader
            icon={Brain}
            title={mode === "create" ? "本初角色" : "修改本初角色"}
            description={mode === "create" ? "持续状态、记忆、日程与自主沉默由本初角色专属运行时处理。" : "表单已合并角色最新的日程、参数、情绪与关系状态。"}
          />
        </div>
        {onClose ? <button aria-label="关闭" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.06] hover:text-white" type="button" onClick={onClose}>×</button> : null}
      </div>

      <JsonImport value={jsonInput} onChange={setJsonInput} onApply={importJson} placeholder='{"type":"prime-figure","name":"Mira","persona":"...","schedule":{"segments":[]},...}' />

      <FormSection title="展示与关系数据 · 不进入上下文" description="名字、图片、属性、标签、介绍、序引、链接 ID、解锁条件和公开状态不会发送给模型。">
        <DisplayFields form={form} unlockText={unlockText} onUnlockTextChange={setUnlockText} onChange={setField} existingAvatarUrl={existingAvatarUrl} existingCoverUrl={existingCoverUrl} />
        <ReferenceImageEditor
          items={form.referenceImages ?? []}
          existingImages={existingReferenceImages}
          onChange={(items) => setField("referenceImages", items)}
        />
      </FormSection>

      <FormSection title="人格与决策 · 进入上下文" description="这些字段参与本初角色的每一轮结构化决策；带 * 的字段必填。">
        <TextField label="人设" required multiline value={form.persona} placeholder="角色是谁，与最终用户是什么关系" onChange={(value) => setField("persona", value)} />
        <TextField label="背景" required multiline value={form.background} placeholder="经历、环境、世界观与长期处境" onChange={(value) => setField("background", value)} />
        <TextField label="性格" required multiline value={form.personality} placeholder="偏好、边界、缺点、矛盾和稳定行为模式" onChange={(value) => setField("personality", value)} />
        <TextField label="回复风格" required multiline value={form.responseStyle} placeholder="语言长度、语气、动作表达和禁忌，图片发送习惯，语音发送习惯...示例回复..." onChange={(value) => setField("responseStyle", value)} />
        <TextField label="决策风格" multiline value={form.decisionStyle ?? ""} placeholder="如何权衡沉默、回应、记忆和自身边界" onChange={(value) => setField("decisionStyle", value)} />
        <TextField label="当前处境" multiline value={form.currentSituation ?? ""} placeholder="角色此刻正在经历的长期情境" onChange={(value) => setField("currentSituation", value)} />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={mode === "create" ? "初始情绪" : "当前情绪"} value={form.initialMood ?? ""} placeholder="平静，但有些疲惫" onChange={(value) => setField("initialMood", value)} />
          <TextField label={mode === "create" ? "初始关系状态" : "当前关系状态"} value={form.initialRelationshipStatus ?? ""} placeholder="熟悉但仍保持边界" onChange={(value) => setField("initialRelationshipStatus", value)} />
        </div>
        <TextField label="行程与长期安排" multiline value={form.itinerary ?? ""} placeholder="使用上海时间的易读时间" onChange={(value) => setField("itinerary", value)} />
      </FormSection>

      <FormSection title="日程感知 · 进入上下文" description="运行时会将消息所在时段转换成决策提示。">
        {(form.schedule?.segments ?? []).map((segment, index) => (
          <div key={index} className="rounded-xl border border-white/10 bg-black/15 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_auto]">
              <input className={inputClass} value={segment.label} placeholder="工作" onChange={(event) => updateSegment(index, { label: event.target.value })} />
              <input className={inputClass} type="time" value={segment.start} onChange={(event) => updateSegment(index, { start: event.target.value })} />
              <input className={inputClass} type="time" value={segment.end} onChange={(event) => updateSegment(index, { end: event.target.value })} />
              <IconButton label="删除日程" onClick={() => setField("schedule", { segments: (form.schedule?.segments ?? []).filter((_, itemIndex) => itemIndex !== index) })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {weekdays.map(([day, label]) => {
                const active = segment.days.includes(day);
                return <button key={day} className={`h-9 min-w-9 rounded-lg border px-2 text-xs ${active ? "border-white bg-white text-black" : "border-white/10 text-white/45"}`} type="button" onClick={() => updateSegment(index, { days: active ? segment.days.filter((item) => item !== day) : [...segment.days, day] })}>{label}</button>;
              })}
            </div>
            <textarea className={`${inputClass} mt-3 min-h-20 py-3`} value={segment.description} placeholder="这个时段角色通常在做什么，是否方便回应" onChange={(event) => updateSegment(index, { description: event.target.value })} />
          </div>
        ))}
        <button className={secondaryButtonClass} type="button" onClick={() => setField("schedule", { segments: [...(form.schedule?.segments ?? []), { label: "", days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00", description: "" }] })}>
          <Plus size={16} />添加日程时段
        </button>
      </FormSection>

      <FormSection title="创作者参数 · 进入上下文" description="参数定义会进入严格结构；每个参数都可以用 null 保留旧值。">
        {variables.map((variable, index) => (
          <VariableEditor key={index} variable={variable} valueLabel={mode === "create" ? "默认值（可选）" : "当前值（可选）"} onChange={(patch) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))} onRemove={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
        ))}
        <button className={secondaryButtonClass} type="button" onClick={() => setVariables((current) => [...current, { key: "", label: "", type: "string", description: "", defaultValueText: "" }])}>
          <Plus size={16} />添加参数
        </button>
      </FormSection>

      <SubmitState error={error ?? externalError ?? null} isSubmitting={isSubmitting} label={mode === "create" ? "创建本初角色" : "保存修改"} />
    </form>
  );
}

type DisplayForm = Pick<CreateSliceFigureRequest, "avatar" | "cover" | "name" | "attributes" | "tags" | "introduction" | "prologueHtml" | "linkedAgentIds" | "unlockConditions" | "isPublic">;

function DisplayFields<T extends DisplayForm>({ form, unlockText, onUnlockTextChange, onChange, existingAvatarUrl, existingCoverUrl }: {
  form: T;
  unlockText: string;
  onUnlockTextChange: (value: string) => void;
  onChange: <K extends keyof T>(key: K, value: T[K]) => void;
  existingAvatarUrl?: string;
  existingCoverUrl?: string;
}) {
  const set = (key: keyof T, value: T[keyof T]) => onChange(key, value);
  const attributes = form.attributes ?? [];
  const tags = form.tags ?? [];
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <ImageInput label="头像" value={form.avatar} existingUrl={existingAvatarUrl} onChange={(value) => set("avatar", value as T[keyof T])} />
        <ImageInput label="封面" value={form.cover} existingUrl={existingCoverUrl} onChange={(value) => set("cover", value as T[keyof T])} />
      </div>
      <TextField label="名字" required value={form.name} placeholder="例如：Mira" onChange={(value) => set("name", value as T[keyof T])} />
      <AttributeEditor items={attributes} onChange={(items) => set("attributes", items as T[keyof T])} />
      <TagEditor items={tags} onChange={(items) => set("tags", items as T[keyof T])} />
      <TextField label="介绍" multiline value={form.introduction ?? ""} placeholder="公开展示或角色卡片上的简介" onChange={(value) => set("introduction", value as T[keyof T])} />
      <TextField label="序引（HTML）" multiline mono value={form.prologueHtml ?? ""} placeholder="<p>展示在对话最前面的容器中，不发送给模型。</p>" onChange={(value) => set("prologueHtml", value as T[keyof T])} />
      <TextField label="链接的角色 ID（逗号分隔）" value={(form.linkedAgentIds ?? []).join(", ")} placeholder="agent_xxx, agent_yyy" onChange={(value) => set("linkedAgentIds", value.split(",").map((item) => item.trim()).filter(Boolean) as T[keyof T])} />
      <TextField label="解锁条件（JSON，占位）" multiline mono value={unlockText} placeholder='{"minimumLevel": 3}' onChange={onUnlockTextChange} />
      <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
        <span><span className="block text-sm font-medium text-white/78">是否公开</span><span className="mt-1 block text-xs text-white/40">仅用于展示与发现，不进入上下文。</span></span>
        <input checked={form.isPublic} type="checkbox" onChange={(event) => set("isPublic", event.target.checked as T[keyof T])} />
      </label>
    </>
  );
}

function AttributeEditor({ items, onChange }: { items: AgentAttribute[]; onChange: (items: AgentAttribute[]) => void }) {
  return (
    <ListPanel title="属性" description="仅供展示，不进入上下文。" onAdd={() => onChange([...items, { key: "", value: "" }])}>
      {items.map((item, index) => (
        <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} value={item.key} placeholder="年龄" onChange={(event) => onChange(items.map((value, itemIndex) => itemIndex === index ? { ...value, key: event.target.value } : value))} />
          <input className={inputClass} value={item.value} placeholder="19" onChange={(event) => onChange(items.map((value, itemIndex) => itemIndex === index ? { ...value, value: event.target.value } : value))} />
          <IconButton label="删除属性" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} />
        </div>
      ))}
    </ListPanel>
  );
}

function TagEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <ListPanel title="标签" description="仅供展示，不进入上下文。" onAdd={() => onChange([...items, ""])}>
      {items.map((item, index) => (
        <div key={index} className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input className={inputClass} value={item} placeholder="陪伴" onChange={(event) => onChange(items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} />
          <IconButton label="删除标签" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} />
        </div>
      ))}
    </ListPanel>
  );
}

function ReferenceImageEditor({
  items,
  existingImages,
  onChange,
}: {
  items: PrimeFigureReferenceImageInput[];
  existingImages: PrimeFigureReferenceImage[];
  onChange: (items: PrimeFigureReferenceImageInput[]) => void;
}) {
  const existingUrls = new Map(
    existingImages.map((item) => [item.resourceId, item.resourcePath]),
  );
  return (
    <ListPanel
      title="更多参考图片"
      description="每张图片必须提供描述，运行时会将其编号加入可参考列表。"
    >
      {items.map((item, index) => {
        const preview = "upload" in item && item.upload
          ? `data:${item.upload.mimeType};base64,${item.upload.dataBase64}`
          : "resourceId" in item
            ? existingUrls.get(item.resourceId)
            : undefined;
        return (
          <div key={"resourceId" in item ? item.resourceId : `${item.upload.fileName}-${index}`} className="grid gap-3 rounded-xl border border-white/10 bg-black/15 p-3 md:grid-cols-[120px_1fr_auto]">
            <div className="h-24 overflow-hidden rounded-lg bg-white/[0.035]">
              {preview ? <img className="h-full w-full object-cover" src={preview} alt="参考图片预览" /> : null}
            </div>
            <textarea
              className={`${inputClass} min-h-24 py-3`}
              value={item.description}
              placeholder="描述人物外观、服装、场景或图片用途"
              onChange={(event) =>
                onChange(
                  items.map((current, itemIndex) =>
                    itemIndex === index
                      ? { ...current, description: event.target.value }
                      : current,
                  ),
                )
              }
            />
            <IconButton
              label="删除参考图片"
              onClick={() =>
                onChange(items.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          </div>
        );
      })}
      <label className={`${secondaryButtonClass} cursor-pointer`}>
        <UploadSimple size={16} />添加图片
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={items.length >= 10}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            onChange([
              ...items,
              { upload: await fileToUpload(file), description: "" },
            ]);
            event.target.value = "";
          }}
        />
      </label>
      {items.length >= 10 ? <p className="text-xs text-white/40">最多添加 10 张创作者参考图片。</p> : null}
    </ListPanel>
  );
}

function VariableEditor({ variable, valueLabel, onChange, onRemove }: { variable: PrimeVariableDraft; valueLabel: string; onChange: (patch: Partial<PrimeVariableDraft>) => void; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/15 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <input className={inputClass} value={variable.key} placeholder="参数键，例如 trust" onChange={(event) => onChange({ key: event.target.value })} />
        <input className={inputClass} value={variable.label} placeholder="显示名称，例如 信任程度" onChange={(event) => onChange({ label: event.target.value })} />
      </div>
      <textarea className={`${inputClass} mt-3 min-h-20 py-3`} value={variable.description} placeholder="说明模型如何判断该参数" onChange={(event) => onChange({ description: event.target.value })} />
      <div className="mt-3 grid gap-3 md:grid-cols-[150px_1fr_auto]">
        <select className={inputClass} value={variable.type} onChange={(event) => onChange({ type: event.target.value as PrimeFigureVariableType, defaultValueText: "" })}>
          <option value="string">字符串</option><option value="number">数字</option><option value="boolean">布尔值</option><option value="json">JSON</option>
        </select>
        <input className={inputClass} value={variable.defaultValueText} placeholder={valueLabel} onChange={(event) => onChange({ defaultValueText: event.target.value })} />
        <IconButton label="删除参数" onClick={onRemove} />
      </div>
      {variable.type === "number" ? <div className="mt-3 grid gap-3 md:grid-cols-2"><input className={inputClass} type="number" value={variable.min ?? ""} placeholder="最小值" onChange={(event) => onChange({ min: event.target.value === "" ? undefined : Number(event.target.value) })} /><input className={inputClass} type="number" value={variable.max ?? ""} placeholder="最大值" onChange={(event) => onChange({ max: event.target.value === "" ? undefined : Number(event.target.value) })} /></div> : null}
    </div>
  );
}

function FormHeader({ icon: Icon, title, description }: { icon: typeof Brain; title: string; description: string }) {
  return <div className="flex items-start gap-4 border-b border-white/10 pb-6"><div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]"><Icon size={24} weight="duotone" /></div><div><h2 className="text-2xl font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-white/48">{description}</p></div></div>;
}

function FormSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="mt-8 border-t border-white/8 pt-7 first:border-t-0"><h3 className="text-lg font-semibold text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-white/42">{description}</p><div className="mt-5 grid gap-4">{children}</div></section>;
}

function TextField({ label, value, placeholder, required, multiline, mono, onChange }: { label: string; value: string; placeholder?: string; required?: boolean; multiline?: boolean; mono?: boolean; onChange: (value: string) => void }) {
  return <label className="block"><span className="text-sm font-medium text-white/78">{label}{required ? " *" : ""}</span>{multiline ? <textarea className={`${inputClass} mt-2 min-h-24 py-3 ${mono ? "font-mono text-xs leading-5" : "leading-6"}`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input className={`${inputClass} mt-2`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function ListPanel({ title, description, onAdd, children }: { title: string; description: string; onAdd?: () => void; children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div><span className="text-sm font-medium text-white/78">{title}</span><p className="mt-1 text-xs text-white/35">{description}</p></div>{onAdd ? <button className="text-sm text-white/55 hover:text-white" type="button" onClick={onAdd}>添加</button> : null}</div><div className="mt-3 grid gap-3">{children}</div></div>;
}

function JsonImport({ value, placeholder, onChange, onApply }: { value: string; placeholder: string; onChange: (value: string) => void; onApply: () => void }) {
  return <section className="mt-7 rounded-xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-semibold text-white">一键 JSON 导入</h3><p className="mt-1 text-xs text-white/40">JSON 可以覆盖创建表单中的全部字段。</p><textarea className={`${inputClass} mt-3 min-h-32 py-3 font-mono text-xs leading-5`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /><button className={`${secondaryButtonClass} mt-3`} type="button" onClick={onApply}>应用 JSON</button></section>;
}

function PromptPreview({ value }: { value: string }) {
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/25 p-4 text-xs leading-5 text-white/70">{value || "（解析结果为空）"}</pre>;
}

function SubmitState({ error, isSubmitting, label }: { error: string | null; isSubmitting: boolean; label: string }) {
  return <>{error ? <p className="mt-6 rounded-xl border border-red-400/15 bg-red-400/[0.04] p-4 text-sm text-red-100/80">{error}</p> : null}<button className="mt-7 flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmitting} type="submit">{isSubmitting ? (label.includes("创建") ? "创建中……" : "保存中……") : label}</button></>;
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button aria-label={label} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white" type="button" onClick={onClick}><Trash size={16} /></button>;
}

function ImageInput({ label, value, existingUrl, onChange }: { label: string; value?: AgentResourceUpload | null; existingUrl?: string; onChange: (value: AgentResourceUpload | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const preview = value ? `data:${value.mimeType};base64,${value.dataBase64}` : value === undefined ? existingUrl : undefined;
  return <label className="block"><span className="text-sm font-medium text-white/78">{label}</span><span className="mt-2 flex min-h-28 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-white/[0.025] p-4 text-center transition hover:border-white/28"><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { onChange(await fileToUpload(file)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "图片读取失败。"); } }} />{preview ? <img className="h-24 w-full rounded-lg object-cover" src={preview} alt={`${label}预览`} /> : <span><UploadSimple className="mx-auto text-white/55" size={24} /><span className="mt-2 block text-xs text-white/45">选择图片</span></span>}</span>{preview ? <button className="mt-2 text-xs text-white/45 hover:text-white" type="button" onClick={() => onChange(null)}>移除</button> : null}{error ? <span className="mt-2 block text-xs text-red-200/70">{error}</span> : null}</label>;
}

export function buildSlicePayload(form: CreateSliceFigureRequest, unlockText: string): CreateSliceFigureRequest | string {
  const common = normalizeDisplayFields(form, unlockText);
  if (typeof common === "string") return common;
  const required = normalizeRequired({ persona: form.persona, background: form.background, personality: form.personality, responseStyle: form.responseStyle, systemPrompt: form.systemPrompt, memorySummaryPrompt: form.memorySummaryPrompt ?? DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT });
  if (typeof required === "string") return required;
  return { ...form, ...common, ...required, type: "slice-figure", currentSituation: form.currentSituation?.trim() ?? "", openingLine: form.openingLine?.trim() ?? "" };
}

export function buildPrimePayload(form: CreatePrimeFigureRequest, drafts: PrimeVariableDraft[], unlockText: string): CreatePrimeFigureRequest | string {
  const common = normalizeDisplayFields(form, unlockText);
  if (typeof common === "string") return common;
  const required = normalizeRequired({ persona: form.persona, background: form.background, personality: form.personality, responseStyle: form.responseStyle });
  if (typeof required === "string") return required;
  for (const segment of form.schedule?.segments ?? []) if (!segment.label.trim() || !segment.description.trim() || !segment.days.length) return "每个日程时段都需要名称、描述和至少一个星期选项。";
  const definitions = parseVariableDrafts(drafts);
  if (typeof definitions === "string") return definitions;
  const referenceImages = (form.referenceImages ?? []).map((item) => ({
    ...item,
    description: item.description.trim(),
  }));
  if (referenceImages.some((item) => !item.description))
    return "每张参考图片都必须提供描述。";
  return { ...form, ...common, ...required, type: "prime-figure", decisionStyle: form.decisionStyle?.trim() ?? "", currentSituation: form.currentSituation?.trim() ?? "", itinerary: form.itinerary?.trim() ?? "", initialMood: form.initialMood?.trim() ?? "", initialRelationshipStatus: form.initialRelationshipStatus?.trim() ?? "", schedule: { segments: form.schedule?.segments ?? [] }, variableDefinitions: definitions, referenceImages };
}

function normalizeDisplayFields(form: DisplayForm, unlockText: string) {
  const name = form.name.trim();
  if (!name) return "名字不能为空。";
  const attributes = (form.attributes ?? []).map((item) => ({ key: item.key.trim(), value: item.value.trim() }));
  if (attributes.some((item) => !item.key || !item.value)) return "属性不能包含空键或空值。";
  const tags = (form.tags ?? []).map((item) => item.trim());
  if (tags.some((item) => !item)) return "标签不能包含空值。";
  let unlockConditions: Record<string, unknown> | null = null;
  if (unlockText.trim()) { try { const parsed = JSON.parse(unlockText) as unknown; if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return "解锁条件必须是 JSON 对象。"; unlockConditions = parsed as Record<string, unknown>; } catch { return "解锁条件不是有效 JSON。"; } }
  return { name, attributes, tags, introduction: form.introduction?.trim() ?? "", prologueHtml: form.prologueHtml?.trim() ?? "", linkedAgentIds: (form.linkedAgentIds ?? []).map((item) => item.trim()).filter(Boolean), unlockConditions, isPublic: form.isPublic };
}

function normalizeRequired(values: Record<string, string>) {
  const labels: Record<string, string> = { persona: "人设", background: "背景", personality: "性格", responseStyle: "回复风格", systemPrompt: "系统提示词", memorySummaryPrompt: "记忆总结提示词" };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) { const trimmed = value.trim(); if (!trimmed) return `${labels[key] ?? key}不能为空。`; result[key] = trimmed; }
  return result;
}

function parseVariableDrafts(drafts: PrimeVariableDraft[]): PrimeFigureVariableDefinition[] | string {
  const keys = new Set<string>();
  const result: PrimeFigureVariableDefinition[] = [];
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return "参数键必须以字母或下划线开头，并且只包含字母、数字和下划线。";
    if (keys.has(key)) return `参数键重复：${key}`;
    keys.add(key);
    if (!draft.label.trim() || !draft.description.trim()) return `参数 ${key} 缺少显示名称或描述。`;
    if (draft.type === "number" && draft.min !== undefined && draft.max !== undefined && draft.min > draft.max) return `参数 ${key} 的最小值不能大于最大值。`;
    const parsed = parseDefault(draft);
    if (typeof parsed === "object" && parsed && "error" in parsed) return parsed.error as string;
    result.push({ key, label: draft.label.trim(), type: draft.type, description: draft.description.trim(), ...(parsed !== undefined ? { defaultValue: parsed } : {}), ...(draft.type === "number" && draft.min !== undefined ? { min: draft.min } : {}), ...(draft.type === "number" && draft.max !== undefined ? { max: draft.max } : {}) });
  }
  return result;
}

function parseDefault(draft: PrimeVariableDraft): PrimeFigureVariableDefinition["defaultValue"] | { error: string } | undefined {
  const value = draft.defaultValueText.trim();
  if (!value) return undefined;
  if (draft.type === "string") return value;
  if (draft.type === "number") { const number = Number(value); return Number.isFinite(number) ? number : { error: `参数 ${draft.key} 的默认值必须是数字。` }; }
  if (draft.type === "boolean") return value === "true" ? true : value === "false" ? false : { error: `参数 ${draft.key} 的默认值必须是 true 或 false。` };
  try { return JSON.parse(value) as PrimeFigureVariableDefinition["defaultValue"]; } catch { return { error: `参数 ${draft.key} 的默认值必须是有效 JSON。` }; }
}

function variableToDraft(variable: PrimeFigureVariableDefinition): PrimeVariableDraft {
  return { key: variable.key, label: variable.label, type: variable.type, description: variable.description, ...(variable.min !== undefined ? { min: variable.min } : {}), ...(variable.max !== undefined ? { max: variable.max } : {}), defaultValueText: variable.defaultValue === undefined ? "" : variable.type === "string" ? String(variable.defaultValue) : JSON.stringify(variable.defaultValue) };
}

function fileToUpload(file: File): Promise<AgentResourceUpload> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const result = String(reader.result ?? ""); const dataBase64 = result.split(",")[1]; if (!dataBase64) return reject(new Error("图片读取失败。")); resolve({ fileName: file.name, mimeType: file.type, dataBase64 }); }; reader.onerror = () => reject(new Error("图片读取失败。")); reader.readAsDataURL(file); });
}

function UnavailableCreatePanel() {
  return <div className="glass-panel rounded-2xl p-8"><Sparkle size={32} weight="duotone" /><h2 className="mt-6 text-3xl font-semibold text-white">本初世界使用独立流程</h2><p className="mt-3 text-sm leading-6 text-white/48">本初世界不会复用切片角色或本初角色的运行时，创建界面将在其数据模型确定后单独实现。</p></div>;
}

const inputClass = "h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/25";
const secondaryButtonClass = "flex w-fit items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/65 transition hover:border-white/25 hover:text-white";
