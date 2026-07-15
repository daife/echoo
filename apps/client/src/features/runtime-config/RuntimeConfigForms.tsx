import type {
  PrimeFigureRuntimeConfigPatch,
  PrimeFigureRuntimeConfigView,
  RuntimeSecretView,
  SliceFigureRuntimeConfigPatch,
  SliceFigureRuntimeConfigView,
} from "@echoo/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

interface FormStatusProps {
  disabled?: boolean;
  error?: string | null;
  notice?: string | null;
}

export function SliceRuntimeConfigForm({
  value,
  onSave,
  disabled,
  error,
  notice,
}: FormStatusProps & {
  value: SliceFigureRuntimeConfigView;
  onSave: (patch: SliceFigureRuntimeConfigPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => sliceDraft(value));
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(sliceDraft(value));
    setApiKey("");
    setClearApiKey(false);
  }, [value]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        llm: {
          provider: draft.provider,
          routingProvider: draft.routingProvider || null,
          baseUrl: draft.baseUrl,
          model: draft.model,
          temperature: Number(draft.temperature),
          maxTokens: Number(draft.maxTokens),
          ...secretChange(apiKey, clearApiKey),
        },
        context: {
          minimumRounds: Number(draft.minimumRounds),
          maximumRounds: Number(draft.maximumRounds),
          memorySummaryRounds: Number(draft.memorySummaryRounds),
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <ConfigSection title="文本模型">
        <TextInput
          label="服务提供商"
          value={draft.provider}
          onChange={(provider) => setDraft({ ...draft, provider })}
        />
        <TextInput
          required={false}
          label="上游路由商（可选）"
          value={draft.routingProvider}
          onChange={(routingProvider) =>
            setDraft({ ...draft, routingProvider })
          }
        />
        <TextInput
          label="API 地址"
          value={draft.baseUrl}
          onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
        />
        <TextInput
          label="模型"
          value={draft.model}
          onChange={(model) => setDraft({ ...draft, model })}
        />
        <NumberInput
          label="温度"
          value={draft.temperature}
          step="0.1"
          onChange={(temperature) => setDraft({ ...draft, temperature })}
        />
        <NumberInput
          label="最大输出 Tokens"
          value={draft.maxTokens}
          onChange={(maxTokens) => setDraft({ ...draft, maxTokens })}
        />
        <SecretInput
          status={value.llm.apiKey}
          value={apiKey}
          clear={clearApiKey}
          onValue={setApiKey}
          onClear={setClearApiKey}
        />
      </ConfigSection>
      <ConfigSection title="上下文与记忆">
        <NumberInput
          label="最小保留轮数"
          value={draft.minimumRounds}
          onChange={(minimumRounds) => setDraft({ ...draft, minimumRounds })}
        />
        <NumberInput
          label="最大保留轮数"
          value={draft.maximumRounds}
          onChange={(maximumRounds) => setDraft({ ...draft, maximumRounds })}
        />
        <NumberInput
          label="记忆总结轮数"
          value={draft.memorySummaryRounds}
          onChange={(memorySummaryRounds) =>
            setDraft({ ...draft, memorySummaryRounds })
          }
        />
      </ConfigSection>
      <FormFooter
        disabled={disabled || saving}
        error={error}
        notice={notice}
        saving={saving}
      />
    </form>
  );
}

export function PrimeRuntimeConfigForm({
  value,
  onSave,
  disabled,
  error,
  notice,
}: FormStatusProps & {
  value: PrimeFigureRuntimeConfigView;
  onSave: (patch: PrimeFigureRuntimeConfigPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => primeDraft(value));
  const [secrets, setSecrets] = useState(() => emptyPrimeSecrets());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(primeDraft(value));
    setSecrets(emptyPrimeSecrets());
  }, [value]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        decisionModel: textModelPatch(draft.decision, secrets.decision),
        outputs: {
          image: {
            enabled: draft.imageEnabled,
            guidanceLevel: draft.imageGuidance,
            generator: endpointPatch(
              draft.imageGenerator,
              secrets.imageGenerator,
            ),
          },
          voice: {
            enabled: draft.voiceEnabled,
            guidanceLevel: draft.voiceGuidance,
            tts: {
              ...draft.tts,
              chunkLength: Number(draft.tts.chunkLength),
              ...secretChange(secrets.tts.value, secrets.tts.clear),
            },
          },
          sticker: { enabled: draft.stickerEnabled },
          transfer: { enabled: draft.transferEnabled },
        },
        optimization: {
          image: {
            enabled: draft.imageEnabled && draft.imageOptimizationEnabled,
            level: draft.imageOptimizationLevel,
            model: textModelPatch(draft.imageOptimizer, secrets.imageOptimizer),
          },
          voice: {
            enabled: draft.voiceEnabled && draft.voiceOptimizationEnabled,
            level: draft.voiceOptimizationLevel,
            model: textModelPatch(draft.voiceOptimizer, secrets.voiceOptimizer),
          },
        },
        understanding: {
          visual: {
            mode: draft.visualMode,
            model: textModelPatch(draft.visualModel, secrets.visualModel),
          },
          audio: {
            mode: draft.audioMode,
            model: textModelPatch(draft.audioModel, secrets.audioModel),
          },
        },
        context: {
          minimumMessages: Number(draft.minimumMessages),
          maximumMessages: Number(draft.maximumMessages),
        },
        typingCharsPerMinute: Number(draft.typingCharsPerMinute),
        messageCoalesceMs: Number(draft.messageCoalesceMs),
        wakeups: {
          proactive: {
            enabled: draft.proactiveWakeupEnabled,
            interactionInvalidationWindowMinutes: Number(
              draft.interactionInvalidationWindowMinutes,
            ),
          },
          passive: {
            enabled: draft.passiveWakeupEnabled,
            milestonesMinutes: [
              Number(draft.passiveFirstMinutes),
              Number(draft.passiveSecondMinutes),
              Number(draft.passiveThirdMinutes),
            ],
          },
        },
      });
    } finally {
      setSaving(false);
    }
  }

  const updateSecret = (key: PrimeSecretKey, patch: Partial<SecretDraft>) =>
    setSecrets((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  return (
    <form className="space-y-5" onSubmit={submit}>
      <ConfigSection title="决策模型">
        <ModelFields
          draft={draft.decision}
          onChange={(decision) => setDraft({ ...draft, decision })}
          status={value.decisionModel.apiKey}
          secret={secrets.decision}
          onSecret={(patch) => updateSecret("decision", patch)}
        />
      </ConfigSection>
      <ConfigSection title="Figure 媒体能力">
        <ToggleInput
          label="允许 figure 发送图片"
          checked={draft.imageEnabled}
          onChange={(imageEnabled) => setDraft({ ...draft, imageEnabled })}
        />
        <SelectInput
          label="生图提示词内嵌指导"
          value={draft.imageGuidance}
          options={GUIDANCE_OPTIONS}
          onChange={(imageGuidance) => setDraft({ ...draft, imageGuidance })}
        />
        <ToggleInput
          label="允许 figure 发送语音"
          checked={draft.voiceEnabled}
          onChange={(voiceEnabled) => setDraft({ ...draft, voiceEnabled })}
        />
        <SelectInput
          label="语音 transcript 内嵌指导"
          value={draft.voiceGuidance}
          options={GUIDANCE_OPTIONS}
          onChange={(voiceGuidance) => setDraft({ ...draft, voiceGuidance })}
        />
        <ToggleInput
          label="允许 figure 发送表情"
          checked={draft.stickerEnabled}
          onChange={(stickerEnabled) => setDraft({ ...draft, stickerEnabled })}
        />
        <ToggleInput
          label="允许 figure 转账、收款或拒收"
          checked={draft.transferEnabled}
          onChange={(transferEnabled) =>
            setDraft({ ...draft, transferEnabled })
          }
        />
      </ConfigSection>
      {draft.imageEnabled ? (
        <ConfigSection title="图像生成模型">
          <ModelFields
            draft={draft.imageGenerator}
            onChange={(imageGenerator) =>
              setDraft({ ...draft, imageGenerator })
            }
            status={value.outputs.image.generator.apiKey}
            secret={secrets.imageGenerator}
            onSecret={(patch) => updateSecret("imageGenerator", patch)}
          />
        </ConfigSection>
      ) : null}
      {draft.voiceEnabled ? (
        <ConfigSection title="TTS 服务">
          <TtsFields
            draft={draft.tts}
            onChange={(tts) => setDraft({ ...draft, tts })}
            status={value.outputs.voice.tts.apiKey}
            secret={secrets.tts}
            onSecret={(patch) => updateSecret("tts", patch)}
          />
        </ConfigSection>
      ) : null}
      <ConfigSection title="额外媒体优化">
        {draft.imageEnabled ? (
          <>
            <ToggleInput
              label="额外生图提示词优化"
              checked={draft.imageOptimizationEnabled}
              onChange={(imageOptimizationEnabled) =>
                setDraft({ ...draft, imageOptimizationEnabled })
              }
            />
            <SelectInput
              label="生图优化档位"
              value={draft.imageOptimizationLevel}
              options={OPTIMIZATION_OPTIONS}
              onChange={(imageOptimizationLevel) =>
                setDraft({ ...draft, imageOptimizationLevel })
              }
            />
          </>
        ) : (
          <p className="text-xs text-white/38">
            图片发送已关闭，生图优化不可用。
          </p>
        )}
        {draft.voiceEnabled ? (
          <>
            <ToggleInput
              label="额外语音 transcript 优化"
              checked={draft.voiceOptimizationEnabled}
              onChange={(voiceOptimizationEnabled) =>
                setDraft({ ...draft, voiceOptimizationEnabled })
              }
            />
            <SelectInput
              label="语音优化档位"
              value={draft.voiceOptimizationLevel}
              options={OPTIMIZATION_OPTIONS}
              onChange={(voiceOptimizationLevel) =>
                setDraft({ ...draft, voiceOptimizationLevel })
              }
            />
          </>
        ) : (
          <p className="text-xs text-white/38">
            语音发送已关闭，语音优化不可用。
          </p>
        )}
        <p className="text-xs text-white/38 md:col-span-2">
          开启额外语音优化后，决策原稿不会展示；流式模式会把优化模型增量送入
          TTS，非流式模式会等待优化完成。
        </p>
      </ConfigSection>
      {draft.imageEnabled && draft.imageOptimizationEnabled ? (
        <ConfigSection title="额外生图优化模型">
          <ModelFields
            draft={draft.imageOptimizer}
            onChange={(imageOptimizer) =>
              setDraft({ ...draft, imageOptimizer })
            }
            status={value.optimization.image.model.apiKey}
            secret={secrets.imageOptimizer}
            onSecret={(patch) => updateSecret("imageOptimizer", patch)}
          />
        </ConfigSection>
      ) : null}
      {draft.voiceEnabled && draft.voiceOptimizationEnabled ? (
        <ConfigSection title="额外语音优化模型">
          <ModelFields
            draft={draft.voiceOptimizer}
            onChange={(voiceOptimizer) =>
              setDraft({ ...draft, voiceOptimizer })
            }
            status={value.optimization.voice.model.apiKey}
            secret={secrets.voiceOptimizer}
            onSecret={(patch) => updateSecret("voiceOptimizer", patch)}
          />
        </ConfigSection>
      ) : null}
      <ConfigSection title="媒体理解">
        <SelectInput
          label="图片与视频理解"
          value={draft.visualMode}
          options={UNDERSTANDING_OPTIONS}
          onChange={(visualMode) => setDraft({ ...draft, visualMode })}
        />
        <SelectInput
          label="语音理解"
          value={draft.audioMode}
          options={UNDERSTANDING_OPTIONS}
          onChange={(audioMode) => setDraft({ ...draft, audioMode })}
        />
      </ConfigSection>
      {draft.visualMode === "auxiliary" ? (
        <ConfigSection title="视觉辅助理解模型">
          <ModelFields
            draft={draft.visualModel}
            onChange={(visualModel) => setDraft({ ...draft, visualModel })}
            status={value.understanding.visual.model.apiKey}
            secret={secrets.visualModel}
            onSecret={(patch) => updateSecret("visualModel", patch)}
          />
        </ConfigSection>
      ) : null}
      {draft.audioMode === "auxiliary" ? (
        <ConfigSection title="听觉辅助理解模型">
          <ModelFields
            draft={draft.audioModel}
            onChange={(audioModel) => setDraft({ ...draft, audioModel })}
            status={value.understanding.audio.model.apiKey}
            secret={secrets.audioModel}
            onSecret={(patch) => updateSecret("audioModel", patch)}
          />
        </ConfigSection>
      ) : null}
      <ConfigSection title="上下文与消息节奏">
        <NumberInput
          label="最小保留消息数"
          value={draft.minimumMessages}
          onChange={(minimumMessages) =>
            setDraft({ ...draft, minimumMessages })
          }
        />
        <NumberInput
          label="最大保留消息数"
          value={draft.maximumMessages}
          onChange={(maximumMessages) =>
            setDraft({ ...draft, maximumMessages })
          }
        />
        <NumberInput
          label="每分钟打字字符数"
          value={draft.typingCharsPerMinute}
          onChange={(typingCharsPerMinute) =>
            setDraft({ ...draft, typingCharsPerMinute })
          }
        />
        <NumberInput
          label="连续消息合并间隔（毫秒）"
          min="0"
          value={draft.messageCoalesceMs}
          onChange={(messageCoalesceMs) =>
            setDraft({ ...draft, messageCoalesceMs })
          }
        />
      </ConfigSection>
      <ConfigSection title="定时唤醒">
        <ToggleInput
          label="允许 figure 主动设置定时唤醒"
          checked={draft.proactiveWakeupEnabled}
          onChange={(proactiveWakeupEnabled) =>
            setDraft({ ...draft, proactiveWakeupEnabled })
          }
        />
        <NumberInput
          label="主动计时互动失效窗口（分钟）"
          min="0"
          value={draft.interactionInvalidationWindowMinutes}
          onChange={(interactionInvalidationWindowMinutes) =>
            setDraft({ ...draft, interactionInvalidationWindowMinutes })
          }
        />
        <ToggleInput
          label="启用系统被动定时唤醒"
          checked={draft.passiveWakeupEnabled}
          onChange={(passiveWakeupEnabled) =>
            setDraft({ ...draft, passiveWakeupEnabled })
          }
        />
        <div className="hidden md:block" />
        <NumberInput
          label="第一次被动唤醒（累计分钟）"
          min="1"
          value={draft.passiveFirstMinutes}
          onChange={(passiveFirstMinutes) =>
            setDraft({ ...draft, passiveFirstMinutes })
          }
        />
        <NumberInput
          label="第二次被动唤醒（累计分钟）"
          min="1"
          value={draft.passiveSecondMinutes}
          onChange={(passiveSecondMinutes) =>
            setDraft({ ...draft, passiveSecondMinutes })
          }
        />
        <NumberInput
          label="第三次被动唤醒（累计分钟）"
          min="1"
          value={draft.passiveThirdMinutes}
          onChange={(passiveThirdMinutes) =>
            setDraft({ ...draft, passiveThirdMinutes })
          }
        />
        <p className="text-xs text-white/38 md:col-span-2">
          三个时间是从周期开始计算的累计里程碑，必须严格递增；已有计时沿用创建时的配置。
        </p>
      </ConfigSection>
      <FormFooter
        disabled={disabled || saving}
        error={error}
        notice={notice}
        saving={saving}
      />
    </form>
  );
}

type EndpointDraft = {
  provider: string;
  routingProvider: string;
  baseUrl: string;
  model: string;
};
type TextModelDraft = EndpointDraft & {
  temperature: string;
  maxTokens: string;
};
type SecretDraft = { value: string; clear: boolean };
type PrimeSecretKey =
  | "decision"
  | "imageGenerator"
  | "tts"
  | "imageOptimizer"
  | "voiceOptimizer"
  | "visualModel"
  | "audioModel";

function ModelFields({
  draft,
  onChange,
  status,
  secret,
  onSecret,
}: {
  draft: EndpointDraft | TextModelDraft;
  onChange: (value: any) => void;
  status: RuntimeSecretView;
  secret: SecretDraft;
  onSecret: (patch: Partial<SecretDraft>) => void;
}) {
  const update = (key: string, value: string) =>
    onChange({ ...draft, [key]: value });
  return (
    <>
      <TextInput
        label="服务提供商"
        value={draft.provider}
        onChange={(value) => update("provider", value)}
      />
      <TextInput
        required={false}
        label="上游路由商（可选）"
        value={draft.routingProvider}
        onChange={(value) => update("routingProvider", value)}
      />
      <TextInput
        label="API 地址"
        value={draft.baseUrl}
        onChange={(value) => update("baseUrl", value)}
      />
      <TextInput
        label="模型"
        value={draft.model}
        onChange={(value) => update("model", value)}
      />
      {"temperature" in draft ? (
        <>
          <NumberInput
            label="温度"
            step="0.1"
            value={draft.temperature}
            onChange={(value) => update("temperature", value)}
          />
          <NumberInput
            label="最大输出 Tokens"
            value={draft.maxTokens}
            onChange={(value) => update("maxTokens", value)}
          />
        </>
      ) : null}
      <SecretInput
        status={status}
        value={secret.value}
        clear={secret.clear}
        onValue={(value) => onSecret({ value })}
        onClear={(clear) => onSecret({ clear })}
      />
    </>
  );
}

function TtsFields({
  draft,
  onChange,
  status,
  secret,
  onSecret,
}: {
  draft: ReturnType<typeof ttsDraft>;
  onChange: (value: ReturnType<typeof ttsDraft>) => void;
  status: RuntimeSecretView;
  secret: SecretDraft;
  onSecret: (patch: Partial<SecretDraft>) => void;
}) {
  const update = (key: keyof typeof draft, value: string) =>
    onChange({ ...draft, [key]: value });
  return (
    <>
      <TextInput
        label="服务提供商"
        value={draft.provider}
        onChange={(value) => update("provider", value)}
      />
      <TextInput
        required={false}
        label="音色 Reference ID"
        value={draft.referenceId}
        onChange={(value) => update("referenceId", value)}
      />
      <TextInput
        label="模型"
        value={draft.model}
        onChange={(value) => update("model", value)}
      />
      <TextInput
        label="HTTP 地址"
        value={draft.httpUrl}
        onChange={(value) => update("httpUrl", value)}
      />
      <TextInput
        label="WebSocket 地址"
        value={draft.wsUrl}
        onChange={(value) => update("wsUrl", value)}
      />
      <TextInput
        label="延迟模式"
        value={draft.latency}
        onChange={(value) => update("latency", value)}
      />
      <NumberInput
        label="分块长度"
        value={draft.chunkLength}
        onChange={(value) => update("chunkLength", value)}
      />
      <SecretInput
        status={status}
        value={secret.value}
        clear={secret.clear}
        onValue={(value) => onSecret({ value })}
        onClear={(clear) => onSecret({ clear })}
      />
    </>
  );
}

function ToggleInput({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/65">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="space-y-1.5 text-sm text-white/58">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="w-full rounded-lg border border-white/10 bg-[#15151a] px-3 py-2.5 text-white outline-none transition focus:border-white/25"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const GUIDANCE_OPTIONS = [
  { value: "basic", label: "基础" },
  { value: "medium", label: "中等" },
  { value: "advanced", label: "高级" },
] as const;
const OPTIMIZATION_OPTIONS = [
  { value: "advanced", label: "高级" },
  { value: "top", label: "顶级" },
] as const;
const UNDERSTANDING_OPTIONS = [
  { value: "native", label: "决策模型原生理解" },
  { value: "auxiliary", label: "辅助模型预先理解" },
] as const;

function ConfigSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 rounded-xl border border-white/8 bg-black/10 p-4 md:grid-cols-2">
      <legend className="px-2 text-xs font-medium uppercase tracking-[0.14em] text-white/42">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1.5 text-sm text-white/58">
      <span>{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 text-white outline-none transition focus:border-white/25"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = "1",
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
}) {
  return (
    <label className="space-y-1.5 text-sm text-white/58">
      <span>{label}</span>
      <input
        required
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 text-white outline-none transition focus:border-white/25"
      />
    </label>
  );
}

function SecretInput({
  status,
  value,
  clear,
  onValue,
  onClear,
}: {
  status: RuntimeSecretView;
  value: string;
  clear: boolean;
  onValue: (value: string) => void;
  onClear: (value: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 text-sm text-white/58">
      <span>API Key</span>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        disabled={clear}
        placeholder={
          status.configured
            ? `${status.masked ?? "已配置"}（留空则保留）`
            : "尚未配置"
        }
        onChange={(event) => onValue(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 text-white outline-none transition focus:border-white/25 disabled:opacity-45"
      />
      <label className="flex items-center gap-2 text-xs text-white/38">
        <input
          type="checkbox"
          checked={clear}
          onChange={(event) => onClear(event.target.checked)}
        />
        清除已存密钥
      </label>
    </div>
  );
}

function FormFooter({
  disabled,
  saving,
  error,
  notice,
}: {
  disabled?: boolean;
  saving: boolean;
  error?: string | null;
  notice?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs">
        <span className="text-red-200/75">{error}</span>
        <span className="text-emerald-200/70">{notice}</span>
      </div>
      <button
        disabled={disabled}
        type="submit"
        className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-45"
      >
        {saving ? "保存中…" : "保存配置"}
      </button>
    </div>
  );
}

function secretChange(value: string, clear: boolean) {
  return clear ? { apiKey: null } : value ? { apiKey: value } : {};
}

function sliceDraft(value: SliceFigureRuntimeConfigView) {
  return {
    provider: value.llm.provider,
    routingProvider: value.llm.routingProvider ?? "",
    baseUrl: value.llm.baseUrl,
    model: value.llm.model,
    temperature: String(value.llm.temperature),
    maxTokens: String(value.llm.maxTokens),
    minimumRounds: String(value.context.minimumRounds),
    maximumRounds: String(value.context.maximumRounds),
    memorySummaryRounds: String(value.context.memorySummaryRounds),
  };
}

function primeDraft(value: PrimeFigureRuntimeConfigView) {
  return {
    decision: textDraft(value.decisionModel),
    imageEnabled: value.outputs.image.enabled,
    imageGuidance: value.outputs.image.guidanceLevel,
    imageGenerator: endpointDraft(value.outputs.image.generator),
    voiceEnabled: value.outputs.voice.enabled,
    stickerEnabled: value.outputs.sticker.enabled,
    transferEnabled: value.outputs.transfer.enabled,
    voiceGuidance: value.outputs.voice.guidanceLevel,
    tts: ttsDraft(value.outputs.voice.tts),
    imageOptimizationEnabled: value.optimization.image.enabled,
    imageOptimizationLevel: value.optimization.image.level,
    imageOptimizer: textDraft(value.optimization.image.model),
    voiceOptimizationEnabled: value.optimization.voice.enabled,
    voiceOptimizationLevel: value.optimization.voice.level,
    voiceOptimizer: textDraft(value.optimization.voice.model),
    visualMode: value.understanding.visual.mode,
    visualModel: textDraft(value.understanding.visual.model),
    audioMode: value.understanding.audio.mode,
    audioModel: textDraft(value.understanding.audio.model),
    minimumMessages: String(value.context.minimumMessages),
    maximumMessages: String(value.context.maximumMessages),
    typingCharsPerMinute: String(value.typingCharsPerMinute),
    messageCoalesceMs: String(value.messageCoalesceMs),
    proactiveWakeupEnabled: value.wakeups.proactive.enabled,
    interactionInvalidationWindowMinutes: String(
      value.wakeups.proactive.interactionInvalidationWindowMinutes,
    ),
    passiveWakeupEnabled: value.wakeups.passive.enabled,
    passiveFirstMinutes: String(value.wakeups.passive.milestonesMinutes[0]),
    passiveSecondMinutes: String(value.wakeups.passive.milestonesMinutes[1]),
    passiveThirdMinutes: String(value.wakeups.passive.milestonesMinutes[2]),
  };
}

function endpointDraft(value: {
  provider: string;
  routingProvider?: string;
  baseUrl: string;
  model: string;
}): EndpointDraft {
  return {
    provider: value.provider,
    routingProvider: value.routingProvider ?? "",
    baseUrl: value.baseUrl,
    model: value.model,
  };
}

function textDraft(value: {
  provider: string;
  routingProvider?: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}): TextModelDraft {
  return {
    ...endpointDraft(value),
    temperature: String(value.temperature),
    maxTokens: String(value.maxTokens),
  };
}

function ttsDraft(
  value: PrimeFigureRuntimeConfigView["outputs"]["voice"]["tts"],
) {
  return {
    provider: value.provider,
    referenceId: value.referenceId,
    model: value.model,
    httpUrl: value.httpUrl,
    wsUrl: value.wsUrl,
    latency: value.latency,
    chunkLength: String(value.chunkLength),
  };
}

function emptyPrimeSecrets(): Record<PrimeSecretKey, SecretDraft> {
  return Object.fromEntries(
    [
      "decision",
      "imageGenerator",
      "tts",
      "imageOptimizer",
      "voiceOptimizer",
      "visualModel",
      "audioModel",
    ].map((key) => [key, { value: "", clear: false }]),
  ) as Record<PrimeSecretKey, SecretDraft>;
}

function endpointPatch(draft: EndpointDraft, secret: SecretDraft) {
  return {
    provider: draft.provider,
    routingProvider: draft.routingProvider || null,
    baseUrl: draft.baseUrl,
    model: draft.model,
    ...secretChange(secret.value, secret.clear),
  };
}

function textModelPatch(draft: TextModelDraft, secret: SecretDraft) {
  return {
    ...endpointPatch(draft, secret),
    temperature: Number(draft.temperature),
    maxTokens: Number(draft.maxTokens),
  };
}
