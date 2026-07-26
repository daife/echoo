import { UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";

export type JsonImportFile = Pick<File, "name" | "text">;

export async function readJsonImportFile(
  files: ArrayLike<JsonImportFile>,
): Promise<string> {
  const file = Array.from(files).find((item) =>
    item.name.toLowerCase().endsWith(".json"),
  );
  if (!file) throw new Error("请选择 .json 文件。");
  try {
    return await file.text();
  } catch {
    throw new Error("无法读取 JSON 文件，请重试。");
  }
}

export function JsonImport({
  value,
  placeholder,
  onChange,
  onApply,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onApply: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const loadFile = async (files: FileList | File[]) => {
    try {
      const text = await readJsonImportFile(files);
      setFileError(null);
      onChange(text);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "无法读取 JSON 文件，请重试。",
      );
    }
  };

  return (
    <section className="mt-7 rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            如果你之前有导出的 JSON，可以在这里一键导入
          </h3>
          <p className="mt-1 text-xs leading-5 text-white/48">
            粘贴内容、选择文件，或把 .json 文件拖到下方输入框。
          </p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:border-white/20 hover:text-white"
          type="button"
          onClick={() => fileInput.current?.click()}
        >
          <UploadSimple size={14} /> 选择 JSON 文件
        </button>
      </div>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept="application/json,.json"
        aria-label="选择 JSON 文件"
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) void loadFile(files);
          event.currentTarget.value = "";
        }}
      />
      <div
        className={`mt-3 rounded-lg border transition ${
          isDragging
            ? "border-white/40 bg-white/[0.08] ring-1 ring-white/15"
            : "border-transparent"
        }`}
        data-drag-active={isDragging ? "true" : "false"}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setIsDragging(false);
          if (event.dataTransfer.files.length)
            void loadFile(event.dataTransfer.files);
        }}
      >
        <textarea
          className="min-h-32 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3 font-mono text-xs leading-5 text-white outline-none transition placeholder:text-white/25 focus:border-white/25"
          aria-label="JSON 内容"
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            setFileError(null);
            onChange(event.target.value);
          }}
        />
      </div>
      {fileError ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {fileError}
        </p>
      ) : null}
      <button
        className="mt-3 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-white transition hover:border-white/30 disabled:opacity-40"
        type="button"
        disabled={!value.trim()}
        onClick={onApply}
      >
        应用 JSON
      </button>
    </section>
  );
}
