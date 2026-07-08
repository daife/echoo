import { ArrowRight, Brain, CirclesThreePlus, Sparkle } from "@phosphor-icons/react";
import type { Agent, CreateSliceAgentRequest } from "@echoo/shared";
import { useState } from "react";

const fields = [
  { key: "name", label: "智能体名字", placeholder: "例如：Mira" },
  { key: "persona", label: "人设", placeholder: "它是谁？和用户是什么关系？" },
  { key: "background", label: "背景", placeholder: "它从哪里来？经历、世界观或任务背景是什么？" },
  { key: "personality", label: "性格", placeholder: "温柔、克制、直接、幽默、安静..." },
  { key: "speechStyle", label: "说话风格", placeholder: "短句、诗意、口语化、结构化、带一点吐槽..." },
  { key: "openingLine", label: "开场白", placeholder: "第一次进入对话时，它会说什么？" }
] satisfies Array<{ key: keyof Omit<CreateSliceAgentRequest, "type">; label: string; placeholder: string }>;

const initialForm: CreateSliceAgentRequest = {
  type: "slice",
  name: "",
  persona: "",
  background: "",
  personality: "",
  speechStyle: "",
  openingLine: ""
};

export function CreateAgentPage({
  onCreateSliceAgent
}: {
  onCreateSliceAgent: (input: CreateSliceAgentRequest) => Promise<Agent>;
}) {
  const [form, setForm] = useState<CreateSliceAgentRequest>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (key: keyof Omit<CreateSliceAgentRequest, "type">, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreateSliceAgent(form);
      setForm(initialForm);
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
          Co-create a Slice agent
        </div>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] text-white md:text-6xl">
          Shape a focused companion from tone, story, and first words.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-white/52">
          当前先开放 Slice 类型创建。Core 会需要不同的长期记忆和关系设置，后续单独补。
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <article className="glass-panel rounded-2xl p-6 opacity-55">
            <div className="flex items-start justify-between gap-6">
              <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                <Brain size={28} weight="duotone" />
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">Core</span>
            </div>
            <h2 className="mt-8 text-3xl font-semibold text-white">Core later</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">长期陪伴、稳定记忆和深层关系设置会走独立创建流程。</p>
          </article>

          <article className="glass-panel rounded-2xl p-6 ring-1 ring-white/12">
            <div className="flex items-start justify-between gap-6">
              <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                <CirclesThreePlus size={28} weight="duotone" />
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#09090b]">Slice</span>
            </div>
            <h2 className="mt-8 text-3xl font-semibold text-white">Create a Slice</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">适合短场景、轻量人格、快速试验和临时任务。</p>
          </article>
        </div>

        <form className="glass-panel rounded-2xl p-6 md:p-8" onSubmit={submit}>
          <div className="grid gap-5">
            {fields.map((field) => {
              const isName = field.key === "name";
              return (
                <label key={field.key} className="block">
                  <span className="text-sm font-medium text-white/78">{field.label}</span>
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
          </div>

          {error ? <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/70">{error}</p> : null}

          <button
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating..." : "Create Slice"}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </section>
  );
}
