import type {
  JsonObject,
  JsonValue,
  PrimeWorldDetail,
  PrimeWorldNode,
  PrimeWorldNodeCatalogEntry,
  PrimeWorldRunTraceEntry,
  PrimeWorldValidationIssue,
} from "@echoo/shared";
import { primeWorldDefinitionSchema } from "@echoo/shared";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { BracketsCurly, ClipboardText, Copy, DownloadSimple, FlowArrow, FloppyDisk, MagnifyingGlass, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PrimeWorldService } from "../../services/PrimeWorldService";

type FlowNode = Node<{ world: PrimeWorldNode; catalog?: PrimeWorldNodeCatalogEntry; inputs: PrimeWorldNodeCatalogEntry["inputs"]; outputs: PrimeWorldNodeCatalogEntry["outputs"] }, "world">;

export function PrimeWorldEditorPage({ detail, conversationId, service, onSave, onClose }: {
  detail: PrimeWorldDetail;
  conversationId: string;
  service: PrimeWorldService;
  onSave: (detail: PrimeWorldDetail, preserveRuntimeState: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [document, setDocument] = useState(() => structuredClone(detail));
  const [source, setSource] = useState(() => JSON.stringify(detail, null, 2));
  const [jsonValid, setJsonValid] = useState(true);
  const [mode, setMode] = useState<"graph" | "json">("graph");
  const [catalog, setCatalog] = useState<PrimeWorldNodeCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [issues, setIssues] = useState<PrimeWorldValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [preserveRuntimeState, setPreserveRuntimeState] = useState(false);
  const [filter, setFilter] = useState("");
  const [trace, setTrace] = useState<PrimeWorldRunTraceEntry[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const flowInstance = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);

  useEffect(() => { void service.catalog().then((value) => setCatalog(value.nodes)); }, [service]);
  useEffect(() => {
    void service.getSnapshot(conversationId).then((snapshot) => snapshot.run ? service.trace(conversationId, snapshot.run.id) : null).then((value) => setTrace(value?.trace ?? [])).catch(() => undefined);
  }, [conversationId, service]);
  const catalogByType = useMemo(() => new Map(catalog.map((entry) => [entry.type, entry])), [catalog]);
  const nodes = useMemo<FlowNode[]>(() => document.workflow.nodes.map((world) => {
    const catalog = catalogByType.get(world.type);
    const ports = resolvedPorts(world, catalog, document.workflow.edges);
    return {
      id: world.id,
      type: "world",
      position: document.workflow.editor.positions[world.id] ?? { x: 80, y: 80 },
      data: { world, catalog, ...ports },
    };
  }), [catalogByType, document]);
  const edges = useMemo<Edge[]>(() => document.workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source.nodeId,
    sourceHandle: edge.source.port,
    target: edge.target.nodeId,
    targetHandle: edge.target.port,
    type: "smoothstep",
    animated: edge.kind === "control",
    style: { stroke: edge.kind === "control" ? "#a78bfa" : "#38bdf8" },
  })), [document.workflow.edges]);

  const updateDocument = useCallback((recipe: (value: PrimeWorldDetail) => void) => {
    setDocument((current) => {
      const next = structuredClone(current);
      recipe(next);
      setSource(JSON.stringify(next, null, 2));
      setJsonValid(true);
      return next;
    });
  }, []);
  const onNodesChange = useCallback<OnNodesChange<FlowNode>>((changes) => {
    const changed = applyNodeChanges(changes, nodes);
    updateDocument((next) => {
      const retained = new Set(changed.map((node) => node.id));
      next.workflow.nodes = next.workflow.nodes.filter((node) => retained.has(node.id));
      next.workflow.edges = next.workflow.edges.filter((edge) => retained.has(edge.source.nodeId) && retained.has(edge.target.nodeId));
      next.workflow.editor.positions = Object.fromEntries(changed.map((node) => [node.id, node.position]));
    });
  }, [nodes, updateDocument]);
  const onEdgesChange = useCallback<OnEdgesChange>((changes) => {
    const changed = applyEdgeChanges(changes, edges);
    updateDocument((next) => {
      const retained = new Set(changed.map((edge) => edge.id));
      next.workflow.edges = next.workflow.edges.filter((edge) => retained.has(edge.id));
    });
  }, [edges, updateDocument]);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    const source = document.workflow.nodes.find((node) => node.id === connection.source);
    const sourcePort = source ? resolvedPorts(source, catalogByType.get(source.type), document.workflow.edges).outputs.find((port) => port.name === connection.sourceHandle) : undefined;
    updateDocument((next) => {
      next.workflow.edges.push({
        id: crypto.randomUUID(),
        kind: sourcePort?.type === "control" ? "control" : "data",
        source: { nodeId: connection.source, port: connection.sourceHandle! },
        target: { nodeId: connection.target, port: connection.targetHandle! },
      });
    });
  }, [catalogByType, document.workflow.nodes, updateDocument]);
  const addNode = useCallback((type: string, position: { x: number; y: number }) => {
    const entry = catalogByType.get(type);
    if (!entry) return;
    const id = `${type.replace(/[^a-zA-Z0-9]+/g, "_")}_${crypto.randomUUID().slice(0, 6)}`;
    const config = defaultConfig(entry.configSchema);
    updateDocument((next) => {
      next.workflow.nodes.push({ id, type, version: entry.version, name: entry.title, config });
      next.workflow.editor.positions[id] = position;
    });
    setSelectedId(id);
  }, [catalogByType, updateDocument]);
  const duplicateSelected = () => {
    const original = document.workflow.nodes.find((node) => node.id === selectedId);
    if (!original) return;
    const id = `${original.id}_copy_${crypto.randomUUID().slice(0, 4)}`;
    updateDocument((next) => {
      next.workflow.nodes.push({ ...structuredClone(original), id, name: `${original.name ?? original.type} 副本` });
      const position = next.workflow.editor.positions[original.id] ?? { x: 80, y: 80 };
      next.workflow.editor.positions[id] = { x: position.x + 36, y: position.y + 36 };
    });
    setSelectedId(id);
  };
  const deleteSelected = () => selectedId && updateDocument((next) => {
    next.workflow.nodes = next.workflow.nodes.filter((node) => node.id !== selectedId);
    next.workflow.edges = next.workflow.edges.filter((edge) => edge.source.nodeId !== selectedId && edge.target.nodeId !== selectedId);
    delete next.workflow.editor.positions[selectedId];
    setSelectedId(undefined);
  });
  const save = async () => {
    if (!jsonValid) { setMode("json"); return; }
    setSaving(true);
    try {
      const result = await service.validate(document);
      setIssues(result.issues);
      if (!result.valid) return;
      await onSave(document, preserveRuntimeState);
      onClose();
    } catch (error) {
      setIssues([{ code: "VALIDATION_ERROR", pointer: "/", message: error instanceof Error ? error.message : "工作流校验失败。" }]);
    } finally { setSaving(false); }
  };
  const selected = document.workflow.nodes.find((node) => node.id === selectedId);
  const exportBundle = async () => {
    const bundle = await service.exportBundle(conversationId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const anchor = window.document.createElement("a");
    anchor.href = url; anchor.download = `${bundle.name}.echoo-world.json`; anchor.click();
    URL.revokeObjectURL(url);
  };
  const importBundleText = async (text: string) => {
    try {
      await service.importBundle(JSON.parse(text));
      setIssues([{ code: "BUNDLE_IMPORTED", pointer: "/", message: "已导入为一个新的本初世界。" }]);
    } catch (error) {
      setIssues([{ code: "BUNDLE_INVALID", pointer: "/", message: error instanceof Error ? error.message : "导入失败。" }]);
    }
  };
  const importBundleFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("当前环境不允许读取剪贴板，请选择 bundle 文件。");
      await importBundleText(await navigator.clipboard.readText());
    } catch (error) {
      setIssues([{ code: "CLIPBOARD_UNAVAILABLE", pointer: "/", message: error instanceof Error ? error.message : "无法读取剪贴板。" }]);
    }
  };

  return (
    <div className="flex h-[min(78vh,54rem)] min-h-[42rem] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div><p className="text-[11px] uppercase tracking-[.18em] text-white/35">Revision {detail.definitionRevision}</p><h2 className="font-semibold text-white">世界工作流</h2></div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 p-1"><ModeButton active={mode === "graph"} onClick={() => setMode("graph")} icon={<FlowArrow size={15}/>} label="画布"/><ModeButton active={mode === "json"} onClick={() => setMode("json")} icon={<BracketsCurly size={15}/>} label="JSON"/></div>
          <button title="导出 bundle" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => void exportBundle()}><DownloadSimple size={17}/></button>
          <button title="粘贴 bundle 并导入" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => void importBundleFromClipboard()}><ClipboardText size={17}/></button>
          <button title="导入 bundle" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => importInput.current?.click()}><UploadSimple size={17}/></button>
          <input ref={importInput} className="hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(importBundleText); event.currentTarget.value = ""; }}/>
          <button className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={onClose}><X size={18}/></button>
          <label className="hidden items-center gap-2 text-[11px] text-white/50 xl:flex"><input type="checkbox" checked={preserveRuntimeState} onChange={(event) => setPreserveRuntimeState(event.target.checked)}/>保留运行状态</label>
          <button className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50" disabled={saving || !jsonValid} onClick={() => void save()}><FloppyDisk size={16}/>{saving ? "校验中" : "校验并保存"}</button>
        </div>
      </header>
      {mode === "json" ? <JsonEditor value={source} onChange={(value) => {
        setSource(value);
        try {
          const parsed = primeWorldDefinitionSchema.safeParse(JSON.parse(value));
          if (!parsed.success) throw new Error("schema invalid");
          setDocument(parsed.data as PrimeWorldDetail);
          setJsonValid(true);
        }
        catch { setJsonValid(false); }
      }}/> : (
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_17rem]">
          <aside className="overflow-y-auto border-r border-white/10 p-3">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-2 text-white/45"><MagnifyingGlass size={14}/><input className="min-w-0 bg-transparent text-xs text-white outline-none" placeholder="筛选节点" value={filter} onChange={(event) => setFilter(event.target.value)}/></label>
            {[...new Set(catalog.map((item) => item.category))].map((category) => <div key={category} className="mt-4"><p className="mb-2 text-[10px] uppercase tracking-[.14em] text-white/30">{category}</p>{catalog.filter((item) => item.category === category && `${item.title} ${item.type}`.toLowerCase().includes(filter.toLowerCase())).map((entry) => <button key={entry.type} draggable onDragStart={(event) => event.dataTransfer.setData("application/echoo-world-node", entry.type)} onDoubleClick={() => addNode(entry.type, { x: 100, y: 100 })} className="mb-1.5 block w-full rounded-lg border border-white/10 bg-white/[.035] p-2 text-left hover:border-white/25"><span className="block text-xs text-white/80">{entry.title}</span><span className="block truncate font-mono text-[9px] text-white/35">{entry.type}</span></button>)}</div>)}
          </aside>
          <div className="relative bg-[#0e0e11]" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}>
            <ReactFlow<FlowNode, Edge> nodes={nodes} edges={edges} nodeTypes={{ world: WorldNode }} onInit={(instance) => { flowInstance.current = instance; }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(undefined)} onDrop={(event) => { event.preventDefault(); const type = event.dataTransfer.getData("application/echoo-world-node"); if (type) addNode(type, flowInstance.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 100, y: 100 }); }} fitView deleteKeyCode={["Backspace", "Delete"]} connectionRadius={24}>
              <Background color="#303039" gap={24}/><MiniMap pannable zoomable nodeColor="#6d5bd0"/><Controls/>
            </ReactFlow>
            {selected ? <div className="absolute bottom-3 left-3 flex gap-1 rounded-lg border border-white/10 bg-black/70 p-1"><button className="rounded p-2 text-white/60 hover:bg-white/10" onClick={duplicateSelected}><Copy size={15}/></button><button className="rounded p-2 text-red-300/70 hover:bg-white/10" onClick={deleteSelected}><Trash size={15}/></button></div> : null}
          </div>
          <aside className="overflow-y-auto border-l border-white/10 p-4">{selected ? <ConfigPanel node={selected} schema={catalogByType.get(selected.type)?.configSchema} onChange={(config) => updateDocument((next) => { const node = next.workflow.nodes.find((item) => item.id === selected.id); if (node) node.config = config; })}/> : <p className="text-xs leading-5 text-white/35">选择节点以编辑名称和配置。端口颜色表示控制、数据与流类型。</p>}</aside>
        </div>
      )}
      <footer className="max-h-32 overflow-y-auto border-t border-white/10 bg-black/20 px-4 py-2">{!jsonValid ? <p className="text-xs text-red-300">JSON 语法无效；画布仍保留最后一个有效版本。</p> : issues.length ? issues.map((issue) => <button key={`${issue.pointer}:${issue.code}`} className="mr-3 text-left text-xs text-amber-200/80 hover:text-amber-100" onClick={() => { if (issue.nodeId) { setSelectedId(issue.nodeId); setMode("graph"); } else setMode("json"); }}>{issue.code} · {issue.message}</button>) : trace.length ? trace.slice(-8).map((entry) => <button key={`${entry.sequence}:${entry.phase}`} className="mr-3 text-left font-mono text-[10px] text-white/45 hover:text-white" onClick={() => { setSelectedId(entry.nodeId); setMode("graph"); }}>{entry.nodeId} · {entry.phase} · {entry.durationMs ?? 0}ms</button>) : <p className="text-xs text-white/30">校验问题与最近测试运行 trace 将显示在这里。</p>}</footer>
    </div>
  );
}

function WorldNode({ data, selected }: NodeProps<FlowNode>) {
  const entry = data.catalog;
  return <div className={`min-w-48 rounded-xl border bg-[#18181d] shadow-2xl ${selected ? "border-violet-400" : "border-white/15"}`}>
    <div className="border-b border-white/10 px-3 py-2"><p className="text-xs font-semibold text-white">{data.world.name || entry?.title || data.world.id}</p><p className="font-mono text-[9px] text-violet-300/80">{data.world.type}</p></div>
    <div className="grid grid-cols-2 gap-x-7 gap-y-1 px-2 py-2 text-[9px]">{data.inputs.map((port) => <div key={`i:${port.name}`} className="relative text-white/45" title={port.type}><Handle type="target" position={Position.Left} id={port.name} style={{ background: portColor(port.type), width: 8, height: 8 }}/>{port.name}</div>)}{data.outputs.map((port) => <div key={`o:${port.name}`} className="relative text-right text-white/45" title={port.type}>{port.name}<Handle type="source" position={Position.Right} id={port.name} style={{ background: portColor(port.type), width: 8, height: 8 }}/></div>)}</div>
  </div>;
}

function ConfigPanel({ node, schema, onChange }: { node: PrimeWorldNode; schema?: JsonObject; onChange: (value: JsonObject) => void }) {
  const properties = (schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties : {}) as JsonObject;
  return <div><p className="text-xs font-semibold text-white">{node.name ?? node.type}</p><p className="mt-1 font-mono text-[10px] text-white/35">{node.id}</p><div className="mt-4 space-y-3">{Object.entries(properties).map(([key, field]) => <SchemaField key={key} name={key} schema={field as JsonObject} value={node.config[key]} onChange={(value) => onChange({ ...node.config, [key]: value })}/>)}</div><label className="mt-4 block text-[10px] uppercase tracking-wider text-white/35">完整配置<textarea className="mt-1 min-h-36 w-full rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[10px] text-white/75 outline-none" value={JSON.stringify(node.config, null, 2)} onChange={(event) => { try { onChange(JSON.parse(event.target.value)); } catch { /* retain valid config */ } }}/></label></div>;
}
function SchemaField({ name, schema, value, onChange }: { name: string; schema: JsonObject; value: JsonValue | undefined; onChange: (value: JsonValue) => void }) {
  const enums = Array.isArray(schema.enum) ? schema.enum : undefined;
  const structured = schema.type === "object" || schema.type === "array" || !["string", "number", "integer", "boolean"].includes(String(schema.type));
  return <label className="block text-[10px] uppercase tracking-wider text-white/35"><span>{name}</span>{enums ? <select className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#18181d] px-2 text-xs normal-case text-white" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>{enums.map((item) => <option key={String(item)}>{String(item)}</option>)}</select> : schema.type === "boolean" ? <input className="ml-2" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)}/> : structured ? <textarea className="mt-1 min-h-24 w-full rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[10px] normal-case text-white/75 outline-none" value={JSON.stringify(value ?? (schema.type === "array" ? [] : {}), null, 2)} onChange={(event) => { try { onChange(JSON.parse(event.target.value)); } catch { /* retain the last valid field value */ } }}/> : <input className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs normal-case text-white outline-none" type={schema.type === "number" || schema.type === "integer" ? "number" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => onChange(schema.type === "number" || schema.type === "integer" ? Number(event.target.value) : event.target.value)}/>}</label>;
}

function JsonEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [lineNumbers(), json(), EditorView.lineWrapping, EditorView.updateListener.of((update) => { if (update.docChanged) callback.current(update.state.doc.toString()); }), EditorView.theme({ "&": { height: "100%", backgroundColor: "#0b0b0d", color: "#e5e7eb" }, ".cm-content": { fontFamily: "ui-monospace, monospace", fontSize: "12px" }, ".cm-gutters": { backgroundColor: "#0b0b0d", color: "#555", border: "none" } })] }) });
    return () => view.destroy();
  }, []);
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden"/>;
}

function defaultConfig(schema: JsonObject) { const properties = (schema.properties ?? {}) as JsonObject; const result: JsonObject = {}; for (const [key, raw] of Object.entries(properties)) { const field = raw as JsonObject; if (field.default !== undefined) result[key] = field.default; else if (Array.isArray(field.enum) && field.enum.length) result[key] = field.enum[0]!; else if (field.type === "string") result[key] = ""; else if (field.type === "boolean") result[key] = false; else if (field.type === "number" || field.type === "integer") result[key] = Number(field.minimum ?? 0); else if (field.type === "array") result[key] = []; else if (field.type === "object") result[key] = {}; } return result; }
function resolvedPorts(node: PrimeWorldNode, catalog: PrimeWorldNodeCatalogEntry | undefined, edges: PrimeWorldDetail["workflow"]["edges"]) {
  const inputs = [...(catalog?.inputs ?? [])];
  const outputs = [...(catalog?.outputs ?? [])];
  const add = (target: typeof inputs, name: string, type: PrimeWorldNodeCatalogEntry["inputs"][number]["type"]) => {
    if (!target.some((port) => port.name === name)) target.push({ name, type });
  };
  for (const edge of edges) {
    if (edge.target.nodeId === node.id) add(inputs, edge.target.port, edge.kind === "control" ? "control" : "json");
    if (edge.source.nodeId === node.id) add(outputs, edge.source.port, edge.kind === "control" ? "control" : "json");
  }
  if (node.type === "data.object" && Array.isArray(node.config.fields))
    for (const field of node.config.fields) if (typeof field === "string") add(inputs, field, "json");
  return { inputs, outputs };
}
function portColor(type: string) { return type === "control" ? "#a78bfa" : type.endsWith("stream") ? "#f59e0b" : type === "audio" ? "#ec4899" : "#38bdf8"; }
function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs ${active ? "bg-white text-black" : "text-white/55"}`} onClick={onClick}>{icon}{label}</button>; }
