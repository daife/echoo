import { ArrowRight, Brain, CirclesThreePlus, Sparkle, Trash, UploadSimple } from "@phosphor-icons/react";
import { buildFigureSystemPrompt, type Agent, type AgentAttribute, type AgentResourceUpload, type CreateSliceFigureRequest } from "@echoo/shared";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";

type SliceFigureForm = CreateSliceFigureRequest;

const requiredFields = [
  { key: "name", label: "名字", placeholder: "例如：Mira" },
  { key: "persona", label: "人设", placeholder: "它是谁？和用户是什么关系？" },
  { key: "background", label: "背景", placeholder: "它从哪里来？经历、世界观或任务背景是什么？" },
  { key: "personality", label: "性格", placeholder: "温柔、克制、直接、幽默、安静..." },
  {
    key: "responseStyle",
    label: "回复风格",
    placeholder: "例如：简短、诗意的回复，用括号表示人物心理和动作，比如（愣了一下）"
  }
] satisfies Array<{ key: keyof Pick<SliceFigureForm, "name" | "persona" | "background" | "personality" | "responseStyle">; label: string; placeholder: string }>;

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
  responseStyle: ""
};

export function CreateAgentPage({
  onCreateSliceFigure
}: {
  onCreateSliceFigure: (input: CreateSliceFigureRequest) => Promise<Agent>;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<SliceFigureForm>(initialForm);
  const [jsonInput, setJsonInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);

  const updateField = (key: keyof SliceFigureForm, value: SliceFigureForm[keyof SliceFigureForm]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setPromptPreview(null);
  };

  const updateAttribute = (index: number, key: keyof AgentAttribute, value: string) => {
    const attributes = [...(form.attributes ?? [])];
    attributes[index] = { ...(attributes[index] ?? { key: "", value: "" }), [key]: value };
    updateField("attributes", attributes);
  };

  const removeAttribute = (index: number) => {
    updateField(
      "attributes",
      (form.attributes ?? []).filter((_, itemIndex) => itemIndex !== index)
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
      (form.tags ?? []).filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const updateList = (key: "tags" | "linkedAgentIds", value: string) => {
    updateField(
      key,
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
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
        isPublic: Boolean(parsed.isPublic)
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
      await onCreateSliceFigure(payload);
      setForm(initialForm);
      setJsonInput("");
      setPromptPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-8">
      <div className="glass-panel overflow-hidden rounded-2xl p-7 md:p-10">
        <div className="mb-8 flex items-center gap-3 text-sm text-white/50">
          <Sparkle size={18} />
          Co-create a Slice Figure
        </div>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-6xl">
          Shape a focused companion from identity, story, and response style.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">
          当前先开放 Slice Figure 创建。头像和封面会作为用户资源上传到服务器，figure 只保存资源访问路径。
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <article className="glass-panel rounded-2xl p-6 opacity-55">
            <div className="flex items-start justify-between gap-6">
              <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                <Brain size={28} weight="duotone" />
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">Prime Figure</span>
            </div>
            <h2 className="mt-8 text-3xl font-semibold text-white">Prime Figure later</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">长期推进、稳定记忆、数值和日程控制会走独立创建流程。</p>
          </article>

          <article className="glass-panel rounded-2xl p-6 ring-1 ring-white/12">
            <div className="flex items-start justify-between gap-6">
              <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                <CirclesThreePlus size={28} weight="duotone" />
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#09090b]">Slice Figure</span>
            </div>
            <h2 className="mt-8 text-3xl font-semibold text-white">Create a Slice Figure</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">适合短场景、轻量人格、快速试验和临时任务。</p>
          </article>

          <div className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-white">一键 JSON 导入</h2>
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
        </div>

        <form className="glass-panel rounded-2xl p-6 md:p-8" onSubmit={submit}>
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <ImageInput label="头像" value={form.avatar ?? null} onChange={(value) => updateField("avatar", value)} />
              <ImageInput label="封面" value={form.cover ?? null} onChange={(value) => updateField("cover", value)} />
            </div>

            {requiredFields.map((field) => {
              const isName = field.key === "name";
              return (
                <label key={field.key} className="block">
                  <span className="text-sm font-medium text-white/78">{field.label} *</span>
                  {isName ? (
                    <input
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                      value={form[field.key]}
                      placeholder={field.placeholder}
                      onChange={(event) => updateField(field.key, event.target.value)}
                    />
                  ) : (
                    <textarea
                      className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                      value={form[field.key]}
                      placeholder={field.placeholder}
                      onChange={(event) => updateField(field.key, event.target.value)}
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
                onChange={(event) => updateField("introduction", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-white/78">叙引（HTML，可选）</span>
              <textarea
                className="mt-2 min-h-28 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 font-mono text-xs leading-5 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                value={form.prologueHtml ?? ""}
                placeholder="<p>用于在对话界面最前面的容器中展示。</p>"
                onChange={(event) => updateField("prologueHtml", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-white/78">当前情景（可选）</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                value={form.currentSituation ?? ""}
                placeholder="例如：{{user.name}} 刚结束一天工作，正在深夜和 figure 说话。"
                onChange={(event) => updateField("currentSituation", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-white/78">开场白（可选）</span>
              <textarea
                className="mt-2 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-white/25"
                value={form.openingLine ?? ""}
                placeholder="进入会话时，figure 先展示的一句话。"
                onChange={(event) => updateField("openingLine", event.target.value)}
              />
            </label>

            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-white/78">属性</span>
                  <p className="mt-1 text-xs text-white/35">用于卡片内部右上角标注，不进入 system prompt。</p>
                </div>
                <button className="text-sm text-white/55 hover:text-white" type="button" onClick={() => updateField("attributes", [...(form.attributes ?? []), { key: "", value: "" }])}>
                  Add
                </button>
              </div>
              <div className="mt-3 grid gap-3">
                {(form.attributes ?? []).map((attribute, index) => (
                  <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <input className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" value={attribute.key} placeholder="年龄" onChange={(event) => updateAttribute(index, "key", event.target.value)} />
                    <input className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" value={attribute.value} placeholder="19" onChange={(event) => updateAttribute(index, "value", event.target.value)} />
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
                  <span className="text-sm font-medium text-white/78">Tag</span>
                  <p className="mt-1 text-xs text-white/35">用于卡片底部标注，不进入 system prompt。</p>
                </div>
                <button className="text-sm text-white/55 hover:text-white" type="button" onClick={() => updateField("tags", [...(form.tags ?? []), ""])}>
                  Add
                </button>
              </div>
              <div className="mt-3 grid gap-3">
                {(form.tags ?? []).map((tag, index) => (
                  <div key={index} className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <input
                      className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                      value={tag}
                      placeholder="陪伴"
                      onChange={(event) => updateTag(index, event.target.value)}
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
              <span className="text-sm font-medium text-white/78">链接的 figure ID（逗号分隔）</span>
              <input className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none" value={(form.linkedAgentIds ?? []).join(", ")} placeholder="agent_xxx, agent_yyy" onChange={(event) => updateList("linkedAgentIds", event.target.value)} />
            </label>

            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <span>
                <span className="block text-sm font-medium text-white/78">是否公开 *</span>
                <span className="mt-1 block text-xs text-white/40">公开后可用于未来的探索页和分享场景。</span>
              </span>
              <input checked={form.isPublic} type="checkbox" onChange={(event) => updateField("isPublic", event.target.checked)} />
            </label>
          </div>

          <div className="mt-7">
            <p className="mb-3 text-xs leading-5 text-white/38">
              System prompt 字段可使用 {"{{user.name}}"}、{"{{user.displayName}}"}、{"{{user.email}}"}、{"{{user.id}}"} 占位符。
            </p>
            <button
              className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 transition hover:border-white/25 hover:text-white"
              type="button"
              onClick={() => setPromptPreview(buildFigureSystemPrompt(form, { user }))}
            >
              预览提示词
            </button>
            {promptPreview ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-white/78">System prompt 预览</span>
                  <button className="text-xs text-white/45 transition hover:text-white" type="button" onClick={() => setPromptPreview(null)}>
                    收起
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/65">{promptPreview}</pre>
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/70">{error}</p> : null}

          <button
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating..." : "Create Slice Figure"}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </section>
  );
}

function ImageInput({
  label,
  value,
  onChange
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
      {value ? <span className="mt-3 block truncate text-xs text-white/40">{value.fileName}</span> : null}
    </label>
  );
}

function buildCreatePayload(form: SliceFigureForm): CreateSliceFigureRequest | string {
  const requiredText = {
    name: form.name.trim(),
    persona: form.persona.trim(),
    background: form.background.trim(),
    personality: form.personality.trim(),
    responseStyle: form.responseStyle.trim()
  };

  if (!requiredText.name) return "名字不能为空。";
  if (!requiredText.persona) return "人设不能为空。";
  if (!requiredText.background) return "背景不能为空。";
  if (!requiredText.personality) return "性格不能为空。";
  if (!requiredText.responseStyle) return "回复风格不能为空。";

  const attributes = (form.attributes ?? []).map((attribute) => ({
    key: typeof attribute.key === "string" ? attribute.key.trim() : "",
    value: typeof attribute.value === "string" ? attribute.value.trim() : ""
  }));
  const emptyAttribute = attributes.find((attribute) => !attribute.key || !attribute.value);
  if (emptyAttribute) return "属性不能包含空键或空值，请补全或删除该属性。";

  const tags = (form.tags ?? []).map((tag) => (typeof tag === "string" ? tag.trim() : ""));
  if (tags.some((tag) => !tag)) return "Tag 不能包含空值，请补全或删除该 tag。";

  const linkedAgentIds = (form.linkedAgentIds ?? []).map((agentId) => (typeof agentId === "string" ? agentId.trim() : ""));
  if (linkedAgentIds.some((agentId) => !agentId)) return "链接的 figure ID 不能包含空值。";

  return {
    ...form,
    ...requiredText,
    introduction: form.introduction?.trim() ?? "",
    prologueHtml: form.prologueHtml?.trim() ?? "",
    currentSituation: form.currentSituation?.trim() ?? "",
    openingLine: form.openingLine?.trim() ?? "",
    attributes,
    tags,
    linkedAgentIds
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
        dataBase64: result
      });
    };
    reader.readAsDataURL(file);
  });
}
