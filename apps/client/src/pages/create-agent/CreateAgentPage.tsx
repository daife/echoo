import {
  ArrowRight,
  Brain,
  CirclesThreePlus,
  Plus,
  Sparkle,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  buildFigureSystemPrompt,
  type Agent,
  type AgentAttribute,
  type AgentResourceUpload,
  type AgentType,
  type CreatePrimeFigureRequest,
  type CreateSliceFigureRequest,
  type PrimeFigureScheduleSegment,
  type PrimeFigureVariableDefinition,
  type PrimeFigureVariableType,
} from "@echoo/shared";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";

type SliceFigureForm = CreateSliceFigureRequest;
export type CreateAgentHandlers = {
  "slice-figure": (input: CreateSliceFigureRequest) => Promise<Agent>;
  "prime-figure": (input: CreatePrimeFigureRequest) => Promise<Agent>;
};

const createOptions = [
  {
    type: "prime-figure",
    label: "Prime Figure",
    title: "Create a Prime Figure",
    description:
      "持续人格、带时间的记忆和情绪、日程感知，以及创作者定义的结构化状态。",
    icon: Brain,
  },
  {
    type: "slice-figure",
    label: "Slice Figure",
    title: "Create a Slice Figure",
    description: "适合短场景、轻量人格、快速试验和临时任务。",
    icon: CirclesThreePlus,
  },
  {
    type: "prime-world",
    label: "Prime World",
    title: "Prime World later",
    description: "世界状态、规则推进和多主体事件会走独立创建流程。",
    icon: Sparkle,
  },
] satisfies Array<{
  type: AgentType;
  label: string;
  title: string;
  description: string;
  icon: typeof Brain;
}>;

const requiredFields = [
  { key: "name", label: "名字", placeholder: "例如：Mira" },
  { key: "persona", label: "人设", placeholder: "它是谁？和用户是什么关系？" },
  {
    key: "background",
    label: "背景",
    placeholder: "它从哪里来？经历、世界观或任务背景是什么？",
  },
  {
    key: "personality",
    label: "性格",
    placeholder: "温柔、克制、直接、幽默、安静...",
  },
  {
    key: "responseStyle",
    label: "回复风格",
    placeholder:
      "例如：简短、诗意的回复，用括号表示人物心理和动作，比如（愣了一下）",
  },
] satisfies Array<{
  key: keyof Pick<
    SliceFigureForm,
    "name" | "persona" | "background" | "personality" | "responseStyle"
  >;
  label: string;
  placeholder: string;
}>;

const initialForm: SliceFigureForm = {
  type: "slice-figure",
  name: "",
  attributes: [],
  tags: [],
  introduction: "",
  prologueHtml: "",
  currentSituation: "",
  openingLine: "",
  isPublic: false,
  linkedAgentIds: [],
  unlockConditions: null,
  persona: "",
  background: "",
  personality: "",
  responseStyle: "",
};

export function CreateAgentPage({
  createHandlers,
}: {
  createHandlers: CreateAgentHandlers;
}) {
  const { user } = useAuth();
  const [selectedType, setSelectedType] = useState<AgentType>("slice-figure");
  const [form, setForm] = useState<SliceFigureForm>(initialForm);
  const [jsonInput, setJsonInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);

  const updateField = (
    key: keyof SliceFigureForm,
    value: SliceFigureForm[keyof SliceFigureForm],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
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

  const updateList = (key: "tags" | "linkedAgentIds", value: string) => {
    updateField(
      key,
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as Partial<CreateSliceFigureRequest>;
      setForm({
        ...initialForm,
        ...parsed,
        type: "slice-figure",
        attributes: parsed.attributes ?? [],
        tags: parsed.tags ?? [],
        linkedAgentIds: parsed.linkedAgentIds ?? [],
        unlockConditions: parsed.unlockConditions ?? null,
        isPublic: Boolean(parsed.isPublic),
      });
      setError(null);
      setPromptPreview(null);
    } catch {
      setError("JSON 无法解析，请检查格式。");
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const payload = buildCreatePayload(form);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }

    setIsSubmitting(true);
    try {
      await createHandlers["slice-figure"](payload);
      setForm(initialForm);
      setJsonInput("");
      setPromptPreview(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "创建失败，请稍后再试。",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-8">
      <div className="glass-panel overflow-hidden rounded-2xl p-7 md:p-10">
        <div className="mb-8 flex items-center gap-3 text-sm text-white/50">
          <Sparkle size={18} />
          Co-create an Agent
        </div>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-6xl">
          Shape an LLM-driven agent from the right creation flow.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">
          Slice Figure 面向即时场景，Prime Figure
          面向长期连续的人格、记忆、情绪与自主沉默。
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          {createOptions.map((option) => {
            const Icon = option.icon;
            const active = selectedType === option.type;
            const implemented = option.type !== "prime-world";

            return (
              <button
                key={option.type}
                className={`glass-panel w-full rounded-2xl p-6 text-left transition active:scale-[0.99] ${
                  active
                    ? "ring-1 ring-white/12"
                    : "opacity-55 hover:opacity-80"
                }`}
                type="button"
                onClick={() => setSelectedType(option.type)}
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                    <Icon size={28} weight="duotone" />
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${active ? "bg-white font-semibold text-[#09090b]" : "border border-white/10 text-white/45"}`}
                  >
                    {implemented ? option.label : `${option.label} later`}
                  </span>
                </div>
                <h2 className="mt-8 text-3xl font-semibold text-white">
                  {option.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/52">
                  {option.description}
                </p>
              </button>
            );
          })}

          {selectedType === "slice-figure" ? (
            <div className="glass-panel rounded-2xl p-5">
              <h2 className="text-lg font-semibold text-white">
                一键 JSON 导入
              </h2>
              <textarea
                className="mt-3 min-h-40 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-xs leading-5 text-white outline-none placeholder:text-white/28 focus:border-white/25"
                value={jsonInput}
                placeholder='{"name":"Mira","isPublic":false,"persona":"...","background":"...","personality":"...","responseStyle":"..."}'
                onChange={(event) => setJsonInput(event.target.value)}
              />
              <button
                className="mt-3 rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 transition hover:border-white/25 hover:text-white"
                type="button"
                onClick={importJson}
              >
                Apply JSON
              </button>
            </div>
          ) : null}
        </div>

        {selectedType === "slice-figure" ? (
          <form
            className="glass-panel rounded-2xl p-6 md:p-8"
            onSubmit={submit}
          >
            <div className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <ImageInput
                  label="头像"
                  value={form.avatar ?? null}
                  onChange={(value) => updateField("avatar", value)}
                />
                <ImageInput
                  label="封面"
                  value={form.cover ?? null}
                  onChange={(value) => updateField("cover", value)}
                />
              </div>

              {requiredFields.map((field) => {
                const isName = field.key === "name";
                return (
                  <label key={field.key} className="block">
                    <span className="text-sm font-medium text-white/78">
                      {field.label} *
                    </span>
                    {isName ? (
                      <input
                        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                        value={form[field.key]}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          updateField(field.key, event.target.value)
                        }
                      />
                    ) : (
                      <textarea
                        className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                        value={form[field.key]}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          updateField(field.key, event.target.value)
                        }
                      />
                    )}
                  </label>
                );
              })}

              <label className="block">
                <span className="text-sm font-medium text-white/78">介绍</span>
                <textarea
                  className="mt-2 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                  value={form.introduction ?? ""}
                  placeholder="公开展示或 My figures 卡片上的简介"
                  onChange={(event) =>
                    updateField("introduction", event.target.value)
                  }
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-white/78">
                  叙引（HTML，可选）
                </span>
                <textarea
                  className="mt-2 min-h-28 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 font-mono text-xs leading-5 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                  value={form.prologueHtml ?? ""}
                  placeholder="<p>用于在对话界面最前面的容器中展示。</p>"
                  onChange={(event) =>
                    updateField("prologueHtml", event.target.value)
                  }
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-white/78">
                  当前情景（可选）
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                  value={form.currentSituation ?? ""}
                  placeholder="例如：{{user.name}} 刚结束一天工作，正在深夜和 figure 说话。"
                  onChange={(event) =>
                    updateField("currentSituation", event.target.value)
                  }
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-white/78">
                  开场白（可选）
                </span>
                <textarea
                  className="mt-2 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                  value={form.openingLine ?? ""}
                  placeholder="进入会话时，figure 先展示的一句话。"
                  onChange={(event) =>
                    updateField("openingLine", event.target.value)
                  }
                />
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm font-medium text-white/78">
                      属性
                    </span>
                    <p className="mt-1 text-xs text-white/35">
                      用于卡片内部右上角标注，不进入 system prompt。
                    </p>
                  </div>
                  <button
                    className="text-sm text-white/55 hover:text-white"
                    type="button"
                    onClick={() =>
                      updateField("attributes", [
                        ...(form.attributes ?? []),
                        { key: "", value: "" },
                      ])
                    }
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 grid gap-3">
                  {(form.attributes ?? []).map((attribute, index) => (
                    <div
                      key={index}
                      className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
                    >
                      <input
                        className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                        value={attribute.key}
                        placeholder="年龄"
                        onChange={(event) =>
                          updateAttribute(index, "key", event.target.value)
                        }
                      />
                      <input
                        className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                        value={attribute.value}
                        placeholder="19"
                        onChange={(event) =>
                          updateAttribute(index, "value", event.target.value)
                        }
                      />
                      <button
                        aria-label="删除属性"
                        className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
                        type="button"
                        onClick={() => removeAttribute(index)}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm font-medium text-white/78">
                      Tag
                    </span>
                    <p className="mt-1 text-xs text-white/35">
                      用于卡片底部标注，不进入 system prompt。
                    </p>
                  </div>
                  <button
                    className="text-sm text-white/55 hover:text-white"
                    type="button"
                    onClick={() =>
                      updateField("tags", [...(form.tags ?? []), ""])
                    }
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 grid gap-3">
                  {(form.tags ?? []).map((tag, index) => (
                    <div
                      key={index}
                      className="grid gap-3 md:grid-cols-[1fr_auto]"
                    >
                      <input
                        className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                        value={tag}
                        placeholder="陪伴"
                        onChange={(event) =>
                          updateTag(index, event.target.value)
                        }
                      />
                      <button
                        aria-label="删除 tag"
                        className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
                        type="button"
                        onClick={() => removeTag(index)}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-white/78">
                  链接的 figure ID（逗号分隔）
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none"
                  value={(form.linkedAgentIds ?? []).join(", ")}
                  placeholder="agent_xxx, agent_yyy"
                  onChange={(event) =>
                    updateList("linkedAgentIds", event.target.value)
                  }
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <span>
                  <span className="block text-sm font-medium text-white/78">
                    是否公开 *
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

            <div className="mt-7">
              <p className="mb-3 text-xs leading-5 text-white/38">
                System prompt 字段可使用 {"{{user.name}}"}、
                {"{{user.displayName}}"}、{"{{user.email}}"}、{"{{user.id}}"}{" "}
                占位符。
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
                <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-white/78">
                      System prompt 预览
                    </span>
                    <button
                      className="text-xs text-white/45 transition hover:text-white"
                      type="button"
                      onClick={() => setPromptPreview(null)}
                    >
                      收起
                    </button>
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/65">
                    {promptPreview}
                  </pre>
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/70">
                {error}
              </p>
            ) : null}

            <button
              className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Creating..." : "Create Slice Figure"}
              <ArrowRight size={17} />
            </button>
          </form>
        ) : selectedType === "prime-figure" ? (
          <PrimeFigureCreateForm onCreate={createHandlers["prime-figure"]} />
        ) : (
          <UnavailableCreatePanel type={selectedType} />
        )}
      </div>
    </section>
  );
}

type PrimeVariableDraft = Omit<
  PrimeFigureVariableDefinition,
  "defaultValue"
> & { defaultValueText: string };

const weekdayOptions = [
  ["mon", "一"],
  ["tue", "二"],
  ["wed", "三"],
  ["thu", "四"],
  ["fri", "五"],
  ["sat", "六"],
  ["sun", "日"],
] as const;

function PrimeFigureCreateForm({
  onCreate,
}: {
  onCreate: (input: CreatePrimeFigureRequest) => Promise<Agent>;
}) {
  const [form, setForm] = useState<CreatePrimeFigureRequest>(() => ({
    type: "prime-figure",
    name: "",
    attributes: [],
    tags: [],
    introduction: "",
    isPublic: false,
    persona: "",
    background: "",
    personality: "",
    responseStyle: "",
    decisionStyle: "",
    currentSituation: "",
    schedule: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      segments: [],
    },
    itinerary: "",
    variableDefinitions: [],
    initialMood: "",
    initialRelationshipStatus: "",
  }));
  const [variables, setVariables] = useState<PrimeVariableDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof CreatePrimeFigureRequest>(
    key: K,
    value: CreatePrimeFigureRequest[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const updateSegment = (
    index: number,
    patch: Partial<PrimeFigureScheduleSegment>,
  ) => {
    const segments = [...(form.schedule?.segments ?? [])];
    segments[index] = {
      ...(segments[index] as PrimeFigureScheduleSegment),
      ...patch,
    };
    setField("schedule", {
      timezone: form.schedule?.timezone ?? "UTC",
      segments,
    });
  };

  const addSegment = () => {
    setField("schedule", {
      timezone: form.schedule?.timezone ?? "UTC",
      segments: [
        ...(form.schedule?.segments ?? []),
        {
          label: "",
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "09:00",
          end: "18:00",
          description: "",
        },
      ],
    });
  };

  const addVariable = () => {
    setVariables((current) => [
      ...current,
      {
        key: "",
        label: "",
        type: "string",
        description: "",
        required: false,
        defaultValueText: "",
      },
    ]);
  };

  const updateVariable = (
    index: number,
    patch: Partial<PrimeVariableDraft>,
  ) => {
    setVariables((current) =>
      current.map((variable, itemIndex) =>
        itemIndex === index ? { ...variable, ...patch } : variable,
      ),
    );
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = buildPrimeCreatePayload(form, variables);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate(payload);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Prime Figure 创建失败，请稍后再试。",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="glass-panel rounded-2xl p-6 md:p-8" onSubmit={submit}>
      <div className="flex items-start gap-4 border-b border-white/10 pb-6">
        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
          <Brain size={24} weight="duotone" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-white">Prime Figure</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">
            定义一个从自身人格出发行动的长期 Figure。所有精确时间都会以 Figure
            的日程时区解释。
          </p>
        </div>
      </div>

      <FormSection
        title="身份与声音"
        description="这些字段构成稳定人格，Runtime 会在每轮决策中保持它们。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ImageInput
            label="头像"
            value={form.avatar ?? null}
            onChange={(value) => setField("avatar", value)}
          />
          <ImageInput
            label="封面"
            value={form.cover ?? null}
            onChange={(value) => setField("cover", value)}
          />
        </div>
        <PrimeTextField
          label="名字"
          required
          value={form.name}
          placeholder="例如：Mira"
          onChange={(value) => setField("name", value)}
        />
        <PrimeTextField
          label="公开介绍"
          value={form.introduction ?? ""}
          placeholder="在 Figure 列表中展示的简短介绍"
          onChange={(value) => setField("introduction", value)}
        />
        <PrimeTextField
          multiline
          label="人设"
          required
          value={form.persona}
          placeholder="Figure是谁，与enduser是什么关系"
          onChange={(value) => setField("persona", value)}
        />
        <PrimeTextField
          multiline
          label="背景"
          required
          value={form.background}
          placeholder="经历、环境、世界观与长期处境"
          onChange={(value) => setField("background", value)}
        />
        <PrimeTextField
          multiline
          label="性格"
          required
          value={form.personality}
          placeholder="偏好、边界、缺点、矛盾和稳定行为模式"
          onChange={(value) => setField("personality", value)}
        />
        <PrimeTextField
          multiline
          label="回复风格"
          required
          value={form.responseStyle}
          placeholder="语言长度、语气、动作表达和禁忌"
          onChange={(value) => setField("responseStyle", value)}
        />
        <PrimeTextField
          multiline
          label="决策风格"
          value={form.decisionStyle ?? ""}
          placeholder="如何权衡沉默、回应、记忆和自身边界"
          onChange={(value) => setField("decisionStyle", value)}
        />
        <PrimeTextField
          multiline
          label="当前处境"
          value={form.currentSituation ?? ""}
          placeholder="Figure此刻正在经历的长期情境"
          onChange={(value) => setField("currentSituation", value)}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <PrimeTextField
            label="初始情绪"
            value={form.initialMood ?? ""}
            placeholder="例如：平静，但有些疲惫"
            onChange={(value) => setField("initialMood", value)}
          />
          <PrimeTextField
            label="初始关系状态"
            value={form.initialRelationshipStatus ?? ""}
            placeholder="例如：熟悉但仍保持边界"
            onChange={(value) => setField("initialRelationshipStatus", value)}
          />
        </div>
        <PrimeTextField
          multiline
          label="行程与长期安排"
          value={form.itinerary ?? ""}
          placeholder="使用易读时间，例如：2026-07-12T09:30 前往上海"
          onChange={(value) => setField("itinerary", value)}
        />
      </FormSection>

      <FormSection
        title="日程感知"
        description="Runtime 会把消息落入的具体时段转换成 hint，不把原始时间戳交给模型。"
      >
        <PrimeTextField
          label="IANA 时区"
          required
          value={form.schedule?.timezone ?? "UTC"}
          placeholder="Asia/Shanghai"
          onChange={(value) =>
            setField("schedule", {
              timezone: value,
              segments: form.schedule?.segments ?? [],
            })
          }
        />
        <div className="space-y-4">
          {(form.schedule?.segments ?? []).map((segment, index) => (
            <div
              key={index}
              className="rounded-xl border border-white/10 bg-black/15 p-4"
            >
              <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_auto]">
                <input
                  className={compactInputClass}
                  value={segment.label}
                  placeholder="工作"
                  onChange={(event) =>
                    updateSegment(index, { label: event.target.value })
                  }
                />
                <input
                  className={compactInputClass}
                  type="time"
                  value={segment.start}
                  onChange={(event) =>
                    updateSegment(index, { start: event.target.value })
                  }
                />
                <input
                  className={compactInputClass}
                  type="time"
                  value={segment.end}
                  onChange={(event) =>
                    updateSegment(index, { end: event.target.value })
                  }
                />
                <button
                  aria-label="删除日程"
                  className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/25 hover:text-white active:scale-95"
                  type="button"
                  onClick={() =>
                    setField("schedule", {
                      timezone: form.schedule?.timezone ?? "UTC",
                      segments: (form.schedule?.segments ?? []).filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash size={16} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {weekdayOptions.map(([day, label]) => {
                  const active = segment.days.includes(day);
                  return (
                    <button
                      key={day}
                      className={`h-9 min-w-9 rounded-lg border px-2 text-xs transition active:scale-95 ${active ? "border-white bg-white text-[#09090b]" : "border-white/10 text-white/45 hover:text-white"}`}
                      type="button"
                      onClick={() =>
                        updateSegment(index, {
                          days: active
                            ? segment.days.filter((item) => item !== day)
                            : [...segment.days, day],
                        })
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <textarea
                className={`${compactInputClass} mt-3 min-h-20 py-3`}
                value={segment.description}
                placeholder="这个时段Figure通常在做什么，是否方便回应"
                onChange={(event) =>
                  updateSegment(index, { description: event.target.value })
                }
              />
            </div>
          ))}
        </div>
        <button
          className="flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/65 transition hover:border-white/25 hover:text-white active:scale-[0.98]"
          type="button"
          onClick={addSegment}
        >
          <Plus size={16} />
          添加日程时段
        </button>
      </FormSection>

      <FormSection
        title="创作者参数"
        description="description 会直接进入 strict schema。必填参数每轮必须给出非 null 值，可选参数用 null 表示沿用原值。"
      >
        <div className="space-y-4">
          {variables.map((variable, index) => (
            <div
              key={index}
              className="rounded-xl border border-white/10 bg-black/15 p-4"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className={compactInputClass}
                  value={variable.key}
                  placeholder="参数 key，例如 trust"
                  onChange={(event) =>
                    updateVariable(index, { key: event.target.value })
                  }
                />
                <input
                  className={compactInputClass}
                  value={variable.label}
                  placeholder="显示名称，例如 信任程度"
                  onChange={(event) =>
                    updateVariable(index, { label: event.target.value })
                  }
                />
              </div>
              <textarea
                className={`${compactInputClass} mt-3 min-h-20 py-3`}
                value={variable.description}
                placeholder="必填。说明这个参数代表什么，以及模型应如何判断它"
                onChange={(event) =>
                  updateVariable(index, { description: event.target.value })
                }
              />
              <div className="mt-3 grid gap-3 md:grid-cols-[160px_1fr_auto_auto]">
                <select
                  className={compactInputClass}
                  value={variable.type}
                  onChange={(event) =>
                    updateVariable(index, {
                      type: event.target.value as PrimeFigureVariableType,
                      defaultValueText: "",
                    })
                  }
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
                {variable.type === "boolean" ? (
                  <select
                    className={compactInputClass}
                    value={variable.defaultValueText}
                    onChange={(event) =>
                      updateVariable(index, {
                        defaultValueText: event.target.value,
                      })
                    }
                  >
                    <option value="">无默认值</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className={compactInputClass}
                    value={variable.defaultValueText}
                    placeholder={
                      variable.type === "json"
                        ? "默认 JSON，可留空"
                        : "默认值，可留空"
                    }
                    onChange={(event) =>
                      updateVariable(index, {
                        defaultValueText: event.target.value,
                      })
                    }
                  />
                )}
                <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-white/65">
                  <input
                    checked={variable.required}
                    type="checkbox"
                    onChange={(event) =>
                      updateVariable(index, { required: event.target.checked })
                    }
                  />
                  每轮必填
                </label>
                <button
                  aria-label="删除参数"
                  className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:border-white/25 hover:text-white active:scale-95"
                  type="button"
                  onClick={() =>
                    setVariables((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash size={16} />
                </button>
              </div>
              {variable.type === "number" ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input
                    className={compactInputClass}
                    type="number"
                    value={variable.min ?? ""}
                    placeholder="最小值，可留空"
                    onChange={(event) =>
                      updateVariable(index, {
                        min:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                  <input
                    className={compactInputClass}
                    type="number"
                    value={variable.max ?? ""}
                    placeholder="最大值，可留空"
                    onChange={(event) =>
                      updateVariable(index, {
                        max:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button
          className="flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/65 transition hover:border-white/25 hover:text-white active:scale-[0.98]"
          type="button"
          onClick={addVariable}
        >
          <Plus size={16} />
          添加创作者参数
        </button>
      </FormSection>

      <label className="mt-7 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
        <span>
          <span className="block text-sm font-medium text-white/78">
            公开 Prime Figure
          </span>
          <span className="mt-1 block text-xs text-white/40">
            允许它出现在未来的探索和分享场景。
          </span>
        </span>
        <input
          checked={form.isPublic}
          type="checkbox"
          onChange={(event) => setField("isPublic", event.target.checked)}
        />
      </label>

      {error ? (
        <p className="mt-5 rounded-xl border border-red-300/20 bg-red-400/[0.06] p-4 text-sm text-red-50/85">
          {error}
        </p>
      ) : null}
      <button
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Creating Prime Figure..." : "Create Prime Figure"}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

const compactInputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/30";

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-white/10 pt-7">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-white/42">
        {description}
      </p>
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
}

function PrimeTextField({
  label,
  value,
  placeholder,
  required,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
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
          className={`${compactInputClass} mt-2 min-h-24 py-3 leading-6`}
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={`${compactInputClass} mt-2`}
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function buildPrimeCreatePayload(
  form: CreatePrimeFigureRequest,
  drafts: PrimeVariableDraft[],
): CreatePrimeFigureRequest | string {
  for (const [label, value] of [
    ["名字", form.name],
    ["人设", form.persona],
    ["背景", form.background],
    ["性格", form.personality],
    ["回复风格", form.responseStyle],
  ] as const) {
    if (!value.trim()) return `${label}不能为空。`;
  }
  const timezone = form.schedule?.timezone.trim();
  if (!timezone) return "日程时区不能为空。";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format();
  } catch {
    return "日程时区不是有效的 IANA 时区，例如 Asia/Shanghai。";
  }
  for (const segment of form.schedule?.segments ?? []) {
    if (
      !segment.label.trim() ||
      !segment.description.trim() ||
      !segment.days.length
    )
      return "每个日程时段都需要名称、description 和至少一个星期选项。";
  }

  const keys = new Set<string>();
  const variableDefinitions: PrimeFigureVariableDefinition[] = [];
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      return "参数 key 必须以字母或下划线开头，并且只包含字母、数字和下划线。";
    if (keys.has(key)) return `参数 key 重复：${key}`;
    keys.add(key);
    if (!draft.label.trim()) return `参数 ${key} 缺少显示名称。`;
    if (!draft.description.trim()) return `参数 ${key} 必须提供 description。`;
    if (
      draft.type === "number" &&
      draft.min !== undefined &&
      draft.max !== undefined &&
      draft.min > draft.max
    )
      return `参数 ${key} 的最小值不能大于最大值。`;

    const parsedDefault = parseVariableDefault(draft);
    if (
      typeof parsedDefault === "string" &&
      parsedDefault.startsWith("__error:")
    )
      return parsedDefault.slice(8);
    variableDefinitions.push({
      key,
      label: draft.label.trim(),
      type: draft.type,
      description: draft.description.trim(),
      required: draft.required,
      ...(parsedDefault !== undefined ? { defaultValue: parsedDefault } : {}),
      ...(draft.type === "number" && draft.min !== undefined
        ? { min: draft.min }
        : {}),
      ...(draft.type === "number" && draft.max !== undefined
        ? { max: draft.max }
        : {}),
    });
  }

  return {
    ...form,
    name: form.name.trim(),
    introduction: form.introduction?.trim() ?? "",
    persona: form.persona.trim(),
    background: form.background.trim(),
    personality: form.personality.trim(),
    responseStyle: form.responseStyle.trim(),
    decisionStyle: form.decisionStyle?.trim() ?? "",
    currentSituation: form.currentSituation?.trim() ?? "",
    itinerary: form.itinerary?.trim() ?? "",
    initialMood: form.initialMood?.trim() ?? "",
    initialRelationshipStatus: form.initialRelationshipStatus?.trim() ?? "",
    schedule: { timezone, segments: form.schedule?.segments ?? [] },
    variableDefinitions,
  };
}

function parseVariableDefault(draft: PrimeVariableDraft) {
  const value = draft.defaultValueText.trim();
  if (!value) return undefined;
  if (draft.type === "string") return value;
  if (draft.type === "boolean") return value === "true";
  if (draft.type === "number") {
    const number = Number(value);
    return Number.isFinite(number)
      ? number
      : `__error:参数 ${draft.key || "未命名"} 的默认值必须是数字。`;
  }
  try {
    return JSON.parse(value) as Record<string, unknown> | unknown[] | null;
  } catch {
    return `__error:参数 ${draft.key || "未命名"} 的默认值不是有效 JSON。`;
  }
}

function UnavailableCreatePanel({
  type,
}: {
  type: Exclude<AgentType, "slice-figure">;
}) {
  const option = createOptions.find((item) => item.type === type);

  return (
    <div className="glass-panel grid min-h-[28rem] place-items-center rounded-2xl p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
          <Brain size={26} weight="duotone" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold text-white">
          {option?.label ?? "Agent"} creation is not implemented yet.
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/48">
          这个类型已经有独立入口，后续会接入自己的字段、校验和提交方法。
        </p>
      </div>
    </div>
  );
}

function ImageInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AgentResourceUpload | null;
  onChange: (value: AgentResourceUpload | null) => void;
}) {
  return (
    <label className="block rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-white/78">
        <UploadSimple size={16} />
        {label}
      </span>
      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="mt-3 block w-full text-xs text-white/45 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-[#09090b]"
        type="file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          onChange(file ? await fileToUpload(file) : null);
        }}
      />
      {value ? (
        <span className="mt-3 block truncate text-xs text-white/40">
          {value.fileName}
        </span>
      ) : null}
    </label>
  );
}

function buildCreatePayload(
  form: SliceFigureForm,
): CreateSliceFigureRequest | string {
  const requiredText = {
    name: form.name.trim(),
    persona: form.persona.trim(),
    background: form.background.trim(),
    personality: form.personality.trim(),
    responseStyle: form.responseStyle.trim(),
  };

  if (!requiredText.name) return "名字不能为空。";
  if (!requiredText.persona) return "人设不能为空。";
  if (!requiredText.background) return "背景不能为空。";
  if (!requiredText.personality) return "性格不能为空。";
  if (!requiredText.responseStyle) return "回复风格不能为空。";

  const attributes = (form.attributes ?? []).map((attribute) => ({
    key: typeof attribute.key === "string" ? attribute.key.trim() : "",
    value: typeof attribute.value === "string" ? attribute.value.trim() : "",
  }));
  const emptyAttribute = attributes.find(
    (attribute) => !attribute.key || !attribute.value,
  );
  if (emptyAttribute) return "属性不能包含空键或空值，请补全或删除该属性。";

  const tags = (form.tags ?? []).map((tag) =>
    typeof tag === "string" ? tag.trim() : "",
  );
  if (tags.some((tag) => !tag)) return "Tag 不能包含空值，请补全或删除该 tag。";

  const linkedAgentIds = (form.linkedAgentIds ?? []).map((agentId) =>
    typeof agentId === "string" ? agentId.trim() : "",
  );
  if (linkedAgentIds.some((agentId) => !agentId))
    return "链接的 figure ID 不能包含空值。";

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

function fileToUpload(file: File): Promise<AgentResourceUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve({
        fileName: file.name,
        mimeType: file.type,
        dataBase64: result,
      });
    };
    reader.readAsDataURL(file);
  });
}
