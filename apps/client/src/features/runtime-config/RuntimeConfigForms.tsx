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
  const [llmKey, setLlmKey] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [clearLlmKey, setClearLlmKey] = useState(false);
  const [clearImageKey, setClearImageKey] = useState(false);
  const [clearTtsKey, setClearTtsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(primeDraft(value));
    setLlmKey("");
    setImageKey("");
    setTtsKey("");
    setClearLlmKey(false);
    setClearImageKey(false);
    setClearTtsKey(false);
  }, [value]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        llm: {
          provider: draft.llmProvider,
          routingProvider: draft.llmRoutingProvider || null,
          baseUrl: draft.llmBaseUrl,
          model: draft.llmModel,
          temperature: Number(draft.temperature),
          maxTokens: Number(draft.maxTokens),
          ...secretChange(llmKey, clearLlmKey),
        },
        image: {
          provider: draft.imageProvider,
          routingProvider: draft.imageRoutingProvider || null,
          baseUrl: draft.imageBaseUrl,
          model: draft.imageModel,
          ...secretChange(imageKey, clearImageKey),
        },
        tts: {
          provider: draft.ttsProvider,
          referenceId: draft.referenceId,
          model: draft.ttsModel,
          httpUrl: draft.httpUrl,
          wsUrl: draft.wsUrl,
          latency: draft.latency,
          chunkLength: Number(draft.chunkLength),
          ...secretChange(ttsKey, clearTtsKey),
        },
        context: {
          minimumMessages: Number(draft.minimumMessages),
          maximumMessages: Number(draft.maximumMessages),
        },
        typingCharsPerMinute: Number(draft.typingCharsPerMinute),
        messageCoalesceMs: Number(draft.messageCoalesceMs),
      });
    } finally {
      setSaving(false);
    }
  }

  const update = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form className="space-y-5" onSubmit={submit}>
      <ConfigSection title="决策模型">
        <TextInput
          label="服务提供商"
          value={draft.llmProvider}
          onChange={(value) => update("llmProvider", value)}
        />
        <TextInput
          required={false}
          label="上游路由商（可选）"
          value={draft.llmRoutingProvider}
          onChange={(value) => update("llmRoutingProvider", value)}
        />
        <TextInput
          label="API 地址"
          value={draft.llmBaseUrl}
          onChange={(value) => update("llmBaseUrl", value)}
        />
        <TextInput
          label="模型"
          value={draft.llmModel}
          onChange={(value) => update("llmModel", value)}
        />
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
        <SecretInput
          status={value.llm.apiKey}
          value={llmKey}
          clear={clearLlmKey}
          onValue={setLlmKey}
          onClear={setClearLlmKey}
        />
      </ConfigSection>
      <ConfigSection title="图像生成">
        <TextInput
          label="服务提供商"
          value={draft.imageProvider}
          onChange={(value) => update("imageProvider", value)}
        />
        <TextInput
          required={false}
          label="上游路由商（可选）"
          value={draft.imageRoutingProvider}
          onChange={(value) => update("imageRoutingProvider", value)}
        />
        <TextInput
          label="API 地址"
          value={draft.imageBaseUrl}
          onChange={(value) => update("imageBaseUrl", value)}
        />
        <TextInput
          label="模型"
          value={draft.imageModel}
          onChange={(value) => update("imageModel", value)}
        />
        <SecretInput
          status={value.image.apiKey}
          value={imageKey}
          clear={clearImageKey}
          onValue={setImageKey}
          onClear={setClearImageKey}
        />
      </ConfigSection>
      <ConfigSection title="Fish Audio">
        <TextInput
          label="服务提供商"
          value={draft.ttsProvider}
          onChange={(value) => update("ttsProvider", value)}
        />
        <TextInput
          required={false}
          label="音色 Reference ID"
          value={draft.referenceId}
          onChange={(value) => update("referenceId", value)}
        />
        <TextInput
          label="模型"
          value={draft.ttsModel}
          onChange={(value) => update("ttsModel", value)}
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
          status={value.tts.apiKey}
          value={ttsKey}
          clear={clearTtsKey}
          onValue={setTtsKey}
          onClear={setClearTtsKey}
        />
      </ConfigSection>
      <ConfigSection title="上下文与消息节奏">
        <NumberInput
          label="最小保留消息数"
          value={draft.minimumMessages}
          onChange={(value) => update("minimumMessages", value)}
        />
        <NumberInput
          label="最大保留消息数"
          value={draft.maximumMessages}
          onChange={(value) => update("maximumMessages", value)}
        />
        <NumberInput
          label="每分钟打字字符数"
          value={draft.typingCharsPerMinute}
          onChange={(value) => update("typingCharsPerMinute", value)}
        />
        <NumberInput
          label="连续消息合并间隔（毫秒）"
          min="0"
          value={draft.messageCoalesceMs}
          onChange={(value) => update("messageCoalesceMs", value)}
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
    llmProvider: value.llm.provider,
    llmRoutingProvider: value.llm.routingProvider ?? "",
    llmBaseUrl: value.llm.baseUrl,
    llmModel: value.llm.model,
    temperature: String(value.llm.temperature),
    maxTokens: String(value.llm.maxTokens),
    imageProvider: value.image.provider,
    imageRoutingProvider: value.image.routingProvider ?? "",
    imageBaseUrl: value.image.baseUrl,
    imageModel: value.image.model,
    ttsProvider: value.tts.provider,
    referenceId: value.tts.referenceId,
    ttsModel: value.tts.model,
    httpUrl: value.tts.httpUrl,
    wsUrl: value.tts.wsUrl,
    latency: value.tts.latency,
    chunkLength: String(value.tts.chunkLength),
    minimumMessages: String(value.context.minimumMessages),
    maximumMessages: String(value.context.maximumMessages),
    typingCharsPerMinute: String(value.typingCharsPerMinute),
    messageCoalesceMs: String(value.messageCoalesceMs),
  };
}
