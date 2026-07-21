import type { PrimeWorldDetail } from "@echoo/shared";
import { BracketsCurly, FlowArrow, FloppyDisk, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { PrimeWorldService } from "../../services/PrimeWorldService";

export function PrimeWorldEditorPage({
  detail,
  service,
  onSave,
  onClose,
}: {
  detail: PrimeWorldDetail;
  service: PrimeWorldService;
  onSave: (detail: PrimeWorldDetail) => Promise<void>;
  onClose: () => void;
}) {
  const [source, setSource] = useState(() => JSON.stringify(detail, null, 2));
  const [mode, setMode] = useState<"graph" | "json">("graph");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => {
    try {
      return JSON.parse(source) as PrimeWorldDetail;
    } catch {
      return null;
    }
  }, [source]);
  const save = async () => {
    if (!parsed) {
      setError("定义 JSON 语法无效。");
      setMode("json");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await service.validate(parsed);
      await onSave(parsed);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流校验失败。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex min-h-[38rem] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs text-white/40">
            定义修订 {detail.definitionRevision}
          </p>
          <h2 className="font-semibold text-white">世界工作流</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 p-1">
            <ModeButton
              active={mode === "graph"}
              onClick={() => setMode("graph")}
              icon={<FlowArrow size={15} />}
              label="图谱"
            />
            <ModeButton
              active={mode === "json"}
              onClick={() => setMode("json")}
              icon={<BracketsCurly size={15} />}
              label="JSON"
            />
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10"
            onClick={onClose}
          >
            <X size={18} />
          </button>
          <button
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50"
            disabled={saving || !parsed}
            onClick={() => void save()}
          >
            <FloppyDisk size={16} />
            {saving ? "校验中" : "校验并保存"}
          </button>
        </div>
      </div>
      {mode === "json" ? (
        <textarea
          aria-label="世界定义 JSON"
          spellCheck={false}
          className="min-h-[34rem] flex-1 resize-none bg-black/20 p-4 font-mono text-xs leading-5 text-white/85 outline-none"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      ) : parsed ? (
        <WorkflowGraph detail={parsed} />
      ) : (
        <div className="grid flex-1 place-items-center p-8 text-sm text-red-300">
          JSON 语法无效，请切换到 JSON 修复。
        </div>
      )}
      {error ? (
        <p
          role="alert"
          className="border-t border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs ${active ? "bg-white text-black" : "text-white/55"}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function WorkflowGraph({ detail }: { detail: PrimeWorldDetail }) {
  const positions = detail.workflow.editor.positions;
  const bounds = detail.workflow.nodes.reduce(
    (size, node) => {
      const point = positions[node.id] ?? { x: 40, y: 40 };
      return {
        width: Math.max(size.width, point.x + 210),
        height: Math.max(size.height, point.y + 100),
      };
    },
    { width: 900, height: 520 },
  );
  return (
    <div className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,.08)_1px,transparent_0)] bg-[size:24px_24px]">
      <div
        className="relative"
        style={{ width: bounds.width, height: bounds.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {detail.workflow.edges.map((edge) => {
            const from = positions[edge.source.nodeId] ?? { x: 40, y: 40 };
            const to = positions[edge.target.nodeId] ?? { x: 40, y: 40 };
            const x1 = from.x + 176,
              y1 = from.y + 30,
              x2 = to.x,
              y2 = to.y + 30;
            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edge.kind === "control" ? "#8b5cf6" : "#38bdf8"}
                strokeWidth="2"
                opacity=".7"
              />
            );
          })}
        </svg>
        {detail.workflow.nodes.map((node) => {
          const point = positions[node.id] ?? { x: 40, y: 40 };
          return (
            <div
              key={node.id}
              className="absolute w-44 rounded-lg border border-white/15 bg-[#17171b] p-3 shadow-xl"
              style={{ left: point.x, top: point.y }}
            >
              <p className="truncate text-xs font-semibold text-white">
                {node.name || node.id}
              </p>
              <p className="mt-1 truncate font-mono text-[10px] text-violet-300">
                {node.type}@{node.version}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
