import type { Agent, CreatePrimeWorldRequest, PrimeWorldExportBundle } from "@echoo/shared";
import { useRef, useState } from "react";
import { DEFAULT_PRIME_WORLD_DETAIL } from "../prime-world/primeWorldTemplate";

export function PrimeWorldCreateForm({
  onCreate,
  onImport,
}: {
  onCreate: (input: CreatePrimeWorldRequest) => Promise<Agent>;
  onImport: (bundle: PrimeWorldExportBundle) => Promise<Agent>;
}) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(
    JSON.stringify(DEFAULT_PRIME_WORLD_DETAIL, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bundleText, setBundleText] = useState("");
  const bundleFile = useRef<HTMLInputElement>(null);
  const submit = async () => {
    try {
      setSaving(true);
      setError(null);
      await onCreate({
        type: "prime-world",
        name: name.trim(),
        attributes: [],
        tags: [],
        introduction: "",
        isPublic: false,
        detail: JSON.parse(definition),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败。");
    } finally {
      setSaving(false);
    }
  };
  const importBundle = async () => {
    try {
      setSaving(true);
      setError(null);
      await onImport(JSON.parse(bundleText) as PrimeWorldExportBundle);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入 bundle 失败。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="glass-panel space-y-4 rounded-2xl p-5 md:p-7"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-2xl font-semibold text-white">世界定义</h2>
      <input
        className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-white outline-none"
        placeholder="世界名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <textarea
        className="min-h-80 w-full rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-white outline-none"
        value={definition}
        onChange={(event) => setDefinition(event.target.value)}
      />
      <div className="rounded-xl border border-white/10 bg-white/[.025] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-white/55">或粘贴 / 选择 Prime World bundle</p>
          <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65" onClick={() => bundleFile.current?.click()}>选择文件</button>
        </div>
        <input ref={bundleFile} className="hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setBundleText); event.currentTarget.value = ""; }}/>
        <textarea className="min-h-28 w-full rounded-lg border border-white/10 bg-black/20 p-2 font-mono text-[10px] text-white outline-none" placeholder="粘贴 echoo-prime-world bundle JSON" value={bundleText} onChange={(event) => setBundleText(event.target.value)}/>
        <button type="button" className="mt-2 h-9 rounded-lg border border-white/15 px-4 text-xs text-white disabled:opacity-50" disabled={saving || !bundleText.trim()} onClick={() => void importBundle()}>导入为新世界</button>
      </div>
      <button
        className="h-11 rounded-lg bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
        disabled={saving || !name.trim()}
      >
        {saving ? "创建中" : "创建世界"}
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
