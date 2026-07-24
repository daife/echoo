import { Plus, Trash } from "@phosphor-icons/react";
import {
  primeWorldExportBundleSchema,
  type PrimeWorldExportBundle,
} from "@echoo/shared";
import { useRef } from "react";

export function parsePrimeWorldBundleText(value: string) {
  return primeWorldExportBundleSchema.parse(
    JSON.parse(value),
  ) as PrimeWorldExportBundle;
}

export function PrimeWorldBundleInput({
  value,
  disabled,
  onChange,
  onApply,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onApply: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">应用 bundle JSON</h3>
          <p className="mt-1 text-xs leading-5 text-white/48">
            如果你有导出的 bundle JSON，可以粘贴或选择文件来应用。
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:border-white/20 hover:text-white"
          onClick={() => fileInput.current?.click()}
        >
          选择文件
        </button>
      </div>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(onChange);
          event.currentTarget.value = "";
        }}
      />
      <textarea
        className="mt-3 min-h-28 w-full rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs leading-5 text-white outline-none focus:border-white/25"
        placeholder="粘贴 echoo-prime-world bundle JSON"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="mt-3 h-9 rounded-lg border border-white/15 px-4 text-xs font-medium text-white transition hover:border-white/30 disabled:opacity-40"
        disabled={disabled || !value.trim()}
        onClick={onApply}
      >
        应用 bundle JSON
      </button>
    </section>
  );
}

export function PrimeWorldMetadataFields({
  name,
  tags,
  introduction,
  onNameChange,
  onTagsChange,
  onIntroductionChange,
}: {
  name: string;
  tags: string[];
  introduction: string;
  onNameChange: (value: string) => void;
  onTagsChange: (value: string[]) => void;
  onIntroductionChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <label className="text-xs text-white/50">
        世界名称 <span className="text-white/75">*</span>
        <input
          className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/25"
          value={name}
          placeholder="世界名称"
          required
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <div className="rounded-xl border border-white/8 bg-black/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/50">标签</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 transition hover:border-white/20 hover:text-white"
            onClick={() => onTagsChange([...tags, ""])}
          >
            <Plus size={13} /> 添加标签
          </button>
        </div>
        {tags.length ? (
          <div className="mt-3 grid gap-2">
            {tags.map((tag, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
                <input
                  className="h-10 min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/25"
                  value={tag}
                  placeholder="例如：冒险"
                  onChange={(event) =>
                    onTagsChange(tags.map((value, itemIndex) => itemIndex === index ? event.target.value : value))
                  }
                />
                <button
                  type="button"
                  aria-label={`删除标签 ${index + 1}`}
                  className="grid h-10 w-10 place-items-center rounded-lg text-white/35 transition hover:bg-red-300/10 hover:text-red-200"
                  onClick={() => onTagsChange(tags.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/30">还没有标签，可以按需添加。</p>
        )}
      </div>
      <label className="text-xs text-white/50">
        介绍
        <textarea
          className="mt-2 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-white/25"
          value={introduction}
          placeholder="公开展示或世界卡片上的简介"
          onChange={(event) => onIntroductionChange(event.target.value)}
        />
      </label>
    </section>
  );
}
