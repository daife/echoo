import type { Agent, CreatePrimeWorldRequest } from "@echoo/shared";
import { useState } from "react";
import { DEFAULT_PRIME_WORLD_DETAIL } from "../prime-world/primeWorldTemplate";

export function PrimeWorldCreateForm({
  onCreate,
}: {
  onCreate: (input: CreatePrimeWorldRequest) => Promise<Agent>;
}) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(
    JSON.stringify(DEFAULT_PRIME_WORLD_DETAIL, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
