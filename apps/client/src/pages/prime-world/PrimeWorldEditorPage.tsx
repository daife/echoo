import type { JsonObject, JsonValue, PrimeWorldDetail, PrimeWorldNode, PrimeWorldNodeCatalogEntry, PrimeWorldRunTraceEntry, PrimeWorldValidationIssue } from "@echoo/shared";
import { primeWorldDefinitionSchema } from "@echoo/shared";
import { Background, Controls, Handle, Position, ReactFlow, applyNodeChanges, type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance, type OnEdgesChange, type OnNodesChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { BracketsCurly, ClipboardText, Copy, DownloadSimple, FlowArrow, FloppyDisk, LinkBreak, MagnifyingGlass, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PrimeWorldService } from "../../services/PrimeWorldService";
import { applyPersistentEdgeChanges, applyPersistentNodeChanges, paletteNodePosition } from "./primeWorldGraphChanges";

type FlowNode = Node<
  {
    world: PrimeWorldNode;
    catalog?: PrimeWorldNodeCatalogEntry;
    inputs: PrimeWorldNodeCatalogEntry["inputs"];
    outputs: PrimeWorldNodeCatalogEntry["outputs"];
  },
  "world"
>;

export function PrimeWorldEditorPage({ detail, conversationId, service, onSave, onClose, saveLabel = "校验并保存" }: { detail: PrimeWorldDetail; conversationId?: string; service: PrimeWorldService; onSave: (detail: PrimeWorldDetail, preserveRuntimeState: boolean) => Promise<void>; onClose?: () => void; saveLabel?: string }) {
  const [document, setDocument] = useState(() => structuredClone(detail));
  const [source, setSource] = useState(() => JSON.stringify(detail, null, 2));
  const [jsonValid, setJsonValid] = useState(true);
  const [mode, setMode] = useState<"graph" | "json">("graph");
  const [catalog, setCatalog] = useState<PrimeWorldNodeCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [issues, setIssues] = useState<PrimeWorldValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [preserveRuntimeState, setPreserveRuntimeState] = useState(false);
  const [filter, setFilter] = useState("");
  const [trace, setTrace] = useState<PrimeWorldRunTraceEntry[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const flowInstance = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const paletteAddIndex = useRef(0);
  const paletteDragging = useRef(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(undefined);
    try {
      const value = await service.catalog();
      setCatalog(value.nodes);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "节点目录加载失败。");
    } finally {
      setCatalogLoading(false);
    }
  }, [service]);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);
  useEffect(() => {
    if (!conversationId) return;
    void service
      .getSnapshot(conversationId)
      .then((snapshot) => (snapshot.run ? service.trace(conversationId, snapshot.run.id) : null))
      .then((value) => setTrace(value?.trace ?? []))
      .catch(() => undefined);
  }, [conversationId, service]);
  const catalogByType = useMemo(() => new Map(catalog.map((entry) => [entry.type, entry])), [catalog]);
  const nodeTypes = useMemo(() => ({ world: WorldNode }), []);
  const documentNodes = useMemo<FlowNode[]>(
    () =>
      document.workflow.nodes.map((world) => {
        const catalog = catalogByType.get(world.type);
        const ports = resolvedPorts(world, catalog, document.workflow.edges);
        return {
          id: world.id,
          type: "world",
          position: document.workflow.editor.positions[world.id] ?? {
            x: 80,
            y: 80,
          },
          data: { world, catalog, ...ports },
        };
      }),
    [catalogByType, document],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(documentNodes);
  useEffect(() => {
    setNodes(documentNodes);
  }, [documentNodes]);
  const edges = useMemo<Edge[]>(
    () =>
      document.workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source.nodeId,
        sourceHandle: edge.source.port,
        target: edge.target.nodeId,
        targetHandle: edge.target.port,
        type: "smoothstep",
        animated: edge.kind === "control",
        selected: edge.id === selectedEdgeId,
        style: {
          stroke: edge.kind === "control" ? "#a78bfa" : "#38bdf8",
          strokeWidth: edge.id === selectedEdgeId ? 3 : 1.5,
        },
      })),
    [document.workflow.edges, selectedEdgeId],
  );

  const updateDocument = useCallback((recipe: (value: PrimeWorldDetail) => void | boolean) => {
    setDocument((current) => {
      const next = structuredClone(current);
      if (recipe(next) === false) return current;
      setSource(JSON.stringify(next, null, 2));
      setJsonValid(true);
      return next;
    });
  }, []);
  const onNodesChange = useCallback<OnNodesChange<FlowNode>>(
    (changes) => {
      setNodes((current) => applyNodeChanges(changes, current));
      const persistentChanges = changes.filter((change) => change.type === "remove" || (change.type === "position" && change.position && change.dragging !== true));
      if (persistentChanges.length) updateDocument((next) => applyPersistentNodeChanges(next, persistentChanges));
      if (selectedId && changes.some((change) => change.type === "remove" && change.id === selectedId)) setSelectedId(undefined);
    },
    [selectedId, updateDocument],
  );
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => {
      updateDocument((next) => applyPersistentEdgeChanges(next, changes));
      if (selectedEdgeId && changes.some((change) => change.type === "remove" && change.id === selectedEdgeId)) setSelectedEdgeId(undefined);
    },
    [selectedEdgeId, updateDocument],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
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
    },
    [catalogByType, document.workflow.nodes, updateDocument],
  );
  const addNode = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const entry = catalogByType.get(type);
      if (!entry) return;
      const id = `${type.replace(/[^a-zA-Z0-9]+/g, "_")}_${crypto.randomUUID().slice(0, 6)}`;
      const config = defaultConfig(entry.configSchema);
      updateDocument((next) => {
        next.workflow.nodes.push({
          id,
          type,
          version: entry.version,
          name: entry.title,
          config,
        });
        next.workflow.editor.positions[id] = position;
      });
      setSelectedId(id);
      setSelectedEdgeId(undefined);
    },
    [catalogByType, updateDocument],
  );
  const addNodeAtViewportCenter = useCallback(
    (type: string) => {
      const index = paletteAddIndex.current++;
      const bounds = canvas.current?.getBoundingClientRect();
      const instance = flowInstance.current;
      const offset = (index % 6) * 24;
      const position = bounds && instance ? paletteNodePosition(bounds, (point) => instance.screenToFlowPosition(point), index) : { x: 100 + offset, y: 100 + offset };
      addNode(type, position);
    },
    [addNode],
  );
  const duplicateSelected = () => {
    const original = document.workflow.nodes.find((node) => node.id === selectedId);
    if (!original) return;
    const id = `${original.id}_copy_${crypto.randomUUID().slice(0, 4)}`;
    updateDocument((next) => {
      next.workflow.nodes.push({
        ...structuredClone(original),
        id,
        name: `${original.name ?? original.type} 副本`,
      });
      const position = next.workflow.editor.positions[original.id] ?? {
        x: 80,
        y: 80,
      };
      next.workflow.editor.positions[id] = {
        x: position.x + 36,
        y: position.y + 36,
      };
    });
    setSelectedId(id);
  };
  const deleteSelected = () =>
    selectedId &&
    updateDocument((next) => {
      next.workflow.nodes = next.workflow.nodes.filter((node) => node.id !== selectedId);
      next.workflow.edges = next.workflow.edges.filter((edge) => edge.source.nodeId !== selectedId && edge.target.nodeId !== selectedId);
      delete next.workflow.editor.positions[selectedId];
      setSelectedId(undefined);
    });
  const disconnectSelectedEdge = () =>
    selectedEdgeId &&
    updateDocument((next) => {
      next.workflow.edges = next.workflow.edges.filter((edge) => edge.id !== selectedEdgeId);
      setSelectedEdgeId(undefined);
    });
  const save = async () => {
    if (!jsonValid) {
      setMode("json");
      return;
    }
    setSaving(true);
    try {
      const result = await service.validate(document);
      setIssues(result.issues);
      if (!result.valid) return;
      await onSave(document, preserveRuntimeState);
      onClose?.();
    } catch (error) {
      setIssues([
        {
          code: "VALIDATION_ERROR",
          pointer: "/",
          message: error instanceof Error ? error.message : "工作流校验失败。",
        },
      ]);
    } finally {
      setSaving(false);
    }
  };
  const selected = document.workflow.nodes.find((node) => node.id === selectedId);
  const selectedEdge = document.workflow.edges.find((edge) => edge.id === selectedEdgeId);
  const exportBundle = async () => {
    if (!conversationId) return;
    const bundle = await service.exportBundle(conversationId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${bundle.name}.echoo-world.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importBundleText = async (text: string) => {
    try {
      await service.importBundle(JSON.parse(text));
      setIssues([
        {
          code: "BUNDLE_IMPORTED",
          pointer: "/",
          message: "已导入为一个新的本初世界。",
        },
      ]);
    } catch (error) {
      setIssues([
        {
          code: "BUNDLE_INVALID",
          pointer: "/",
          message: error instanceof Error ? error.message : "导入失败。",
        },
      ]);
    }
  };
  const importBundleFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("当前环境不允许读取剪贴板，请选择 bundle 文件。");
      await importBundleText(await navigator.clipboard.readText());
    } catch (error) {
      setIssues([
        {
          code: "CLIPBOARD_UNAVAILABLE",
          pointer: "/",
          message: error instanceof Error ? error.message : "无法读取剪贴板。",
        },
      ]);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0b0b0d]">
      <header className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[.18em] text-white/35">{conversationId ? `Revision ${detail.definitionRevision}` : "New world"}</p>
          <h2 className="font-semibold text-white">世界工作流</h2>
        </div>
        <div className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <div className="flex rounded-lg border border-white/10 p-1">
            <ModeButton active={mode === "graph"} onClick={() => setMode("graph")} icon={<FlowArrow size={15} />} label="画布" />
            <ModeButton active={mode === "json"} onClick={() => setMode("json")} icon={<BracketsCurly size={15} />} label="JSON" />
          </div>
          {conversationId ? (
            <>
              <button type="button" title="导出 bundle" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => void exportBundle()}>
                <DownloadSimple size={17} />
              </button>
              <button type="button" title="粘贴 bundle 并导入" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => void importBundleFromClipboard()}>
                <ClipboardText size={17} />
              </button>
              <button type="button" title="导入 bundle" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={() => importInput.current?.click()}>
                <UploadSimple size={17} />
              </button>
              <input
                ref={importInput}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then(importBundleText);
                  event.currentTarget.value = "";
                }}
              />
            </>
          ) : null}
          {onClose ? (
            <button type="button" aria-label="关闭编辑器" className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10" onClick={onClose}>
              <X size={18} />
            </button>
          ) : null}
          {conversationId ? (
            <label className="hidden items-center gap-2 text-[11px] text-white/50 xl:flex">
              <input type="checkbox" checked={preserveRuntimeState} onChange={(event) => setPreserveRuntimeState(event.target.checked)} />
              保留运行状态
            </label>
          ) : null}
          <button type="button" className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50" disabled={saving || !jsonValid} onClick={() => void save()}>
            <FloppyDisk size={16} />
            {saving ? "校验中" : saveLabel}
          </button>
        </div>
      </header>
      {mode === "json" ? (
        <JsonEditor
          value={source}
          onChange={(value) => {
            setSource(value);
            try {
              const parsed = primeWorldDefinitionSchema.safeParse(JSON.parse(value));
              if (!parsed.success) throw new Error("schema invalid");
              setDocument(parsed.data as PrimeWorldDetail);
              setJsonValid(true);
            } catch {
              setJsonValid(false);
            }
          }}
        />
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          <div className="grid h-full min-h-0 min-w-[56rem] grid-cols-[13rem_minmax(0,1fr)_22rem] md:min-w-0">
          <aside className="overflow-y-auto border-r border-white/10 p-3">
            <label className="input-focus-shell flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-2 text-white/45">
              <MagnifyingGlass size={14} />
              <input className="min-w-0 bg-transparent text-xs text-white outline-none" placeholder="筛选节点" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </label>
            {catalogLoading ? (
              <p className="mt-4 text-xs text-white/35">正在加载节点目录…</p>
            ) : catalogError ? (
              <div className="mt-4 rounded-lg border border-red-300/15 bg-red-300/[.05] p-3">
                <p className="text-xs leading-5 text-red-200/75">{catalogError}</p>
                <button className="mt-2 text-xs font-medium text-white/70 hover:text-white" onClick={() => void loadCatalog()}>
                  重新加载
                </button>
              </div>
            ) : (
              [...new Set(catalog.map((item) => item.category))].map((category) => (
                <div key={category} className="mt-4">
                  <p className="mb-2 text-[10px] uppercase tracking-[.14em] text-white/30">{category}</p>
                  {catalog
                    .filter((item) => item.category === category && `${item.title} ${item.type}`.toLowerCase().includes(filter.toLowerCase()))
                    .map((entry) => (
                      <button
                        key={entry.type}
                        draggable
                        title="单击添加到画布中心，或拖到指定位置"
                        onDragStart={(event) => {
                          paletteDragging.current = true;
                          event.dataTransfer.setData("application/echoo-world-node", entry.type);
                        }}
                        onDragEnd={() => {
                          window.requestAnimationFrame(() => {
                            paletteDragging.current = false;
                          });
                        }}
                        onClick={() => {
                          if (!paletteDragging.current) addNodeAtViewportCenter(entry.type);
                        }}
                        className="mb-1.5 block w-full rounded-lg border border-white/10 bg-white/[.035] p-2 text-left hover:border-white/25"
                      >
                        <span className="block text-xs text-white/80">{entry.title}</span>
                        <span className="block truncate font-mono text-[9px] text-white/35">{entry.type}</span>
                      </button>
                    ))}
                </div>
              ))
            )}
          </aside>
          <div
            ref={canvas}
            className="relative min-h-0 min-w-0 bg-[#0e0e11]"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
          >
            <ReactFlow<FlowNode, Edge>
              className="h-full w-full"
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                flowInstance.current = instance;
              }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                setSelectedEdgeId(undefined);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedId(undefined);
              }}
              onPaneClick={() => {
                setSelectedId(undefined);
                setSelectedEdgeId(undefined);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const type = event.dataTransfer.getData("application/echoo-world-node");
                if (type)
                  addNode(
                    type,
                    flowInstance.current?.screenToFlowPosition({
                      x: event.clientX,
                      y: event.clientY,
                    }) ?? { x: 100, y: 100 },
                  );
              }}
              fitView
              deleteKeyCode={["Backspace", "Delete"]}
              connectionRadius={24}
            >
              <Background color="#303039" gap={24} />
              <Controls className="overflow-hidden rounded-lg border border-white/10 bg-[#17171b] shadow-[0_10px_30px_rgba(0,0,0,.3)] [&_button]:border-white/10 [&_button]:bg-[#17171b] [&_button]:fill-white/65 [&_button:hover]:bg-[#24242a] [&_button:hover]:fill-white" />
            </ReactFlow>
            {selected ? (
              <div className="absolute bottom-3 left-14 flex gap-1 rounded-lg border border-white/10 bg-black/70 p-1">
                <button type="button" title="复制节点" className="rounded p-2 text-white/60 hover:bg-white/10" onClick={duplicateSelected}>
                  <Copy size={15} />
                </button>
                <button type="button" title="删除节点" className="rounded p-2 text-red-300/70 hover:bg-white/10" onClick={deleteSelected}>
                  <Trash size={15} />
                </button>
              </div>
            ) : selectedEdge ? (
              <button type="button" className="absolute bottom-3 left-14 flex h-9 items-center gap-2 rounded-lg border border-red-300/15 bg-[#211719]/95 px-3 text-xs font-medium text-red-200/80 shadow-lg hover:bg-[#2b1b1e] hover:text-red-100" onClick={disconnectSelectedEdge}>
                <LinkBreak size={15} />
                断开连接
              </button>
            ) : null}
          </div>
          <aside className="overflow-y-auto border-l border-white/10 bg-[#0d0d10] p-4">
            {selected ? (
              <ConfigPanel
                node={selected}
                catalog={catalogByType.get(selected.type)}
                onNameChange={(name) =>
                  updateDocument((next) => {
                    const node = next.workflow.nodes.find((item) => item.id === selected.id);
                    if (node) node.name = name || undefined;
                  })
                }
                onConfigChange={(config) =>
                  updateDocument((next) => {
                    const node = next.workflow.nodes.find((item) => item.id === selected.id);
                    if (node) node.config = config;
                  })
                }
              />
            ) : selectedEdge ? (
              <div>
                <p className="text-xs font-semibold text-white">已选择连接</p>
                <p className="mt-3 break-all font-mono text-[10px] leading-5 text-white/45">
                  {selectedEdge.source.nodeId}.{selectedEdge.source.port}
                  <br />→ {selectedEdge.target.nodeId}.{selectedEdge.target.port}
                </p>
                <button type="button" className="mt-4 flex h-9 items-center gap-2 rounded-lg border border-red-300/15 px-3 text-xs text-red-200/75 hover:bg-red-300/[.06] hover:text-red-100" onClick={disconnectSelectedEdge}>
                  <LinkBreak size={15} />
                  断开这条连接
                </button>
                <p className="mt-3 text-[10px] leading-4 text-white/30">也可以选中连线后按 Delete 或 Backspace。</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-4">
                <p className="text-sm font-medium text-white/65">选择一个节点开始编辑</p>
                <p className="mt-2 text-xs leading-5 text-white/35">点击画布中的节点，这里会用表单解释它的用途和可配置项。单击连线可以查看或断开连接。</p>
              </div>
            )}
          </aside>
          </div>
        </div>
      )}
      <footer className="max-h-32 overflow-y-auto border-t border-white/10 bg-black/20 px-4 py-2">
        {!jsonValid ? (
          <p className="text-xs text-red-300">JSON 语法无效；画布仍保留最后一个有效版本。</p>
        ) : issues.length ? (
          issues.map((issue) => (
            <button
              key={`${issue.pointer}:${issue.code}`}
              className="mr-3 text-left text-xs text-amber-200/80 hover:text-amber-100"
              onClick={() => {
                if (issue.nodeId) {
                  setSelectedId(issue.nodeId);
                  setMode("graph");
                } else setMode("json");
              }}
            >
              {issue.code} · {issue.message}
            </button>
          ))
        ) : trace.length ? (
          trace.slice(-8).map((entry) => (
            <button
              key={`${entry.sequence}:${entry.phase}`}
              className="mr-3 text-left font-mono text-[10px] text-white/45 hover:text-white"
              onClick={() => {
                setSelectedId(entry.nodeId);
                setMode("graph");
              }}
            >
              {entry.nodeId} · {entry.phase} · {entry.durationMs ?? 0}ms
            </button>
          ))
        ) : (
          <p className="text-xs text-white/30">校验问题与最近测试运行 trace 将显示在这里。</p>
        )}
      </footer>
    </div>
  );
}

function WorldNode({ data, selected }: NodeProps<FlowNode>) {
  const entry = data.catalog;
  return (
    <div className={`min-w-48 rounded-xl border bg-[#18181d] shadow-2xl ${selected ? "border-violet-400" : "border-white/15"}`}>
      <div className="border-b border-white/10 px-3 py-2">
        <p className="text-xs font-semibold text-white">{data.world.name || entry?.title || data.world.id}</p>
        <p className="font-mono text-[9px] text-violet-300/80">{data.world.type}</p>
      </div>
      <div className="flex justify-between gap-7 px-3 py-2 text-[9px]">
        <div className="space-y-1">
          {data.inputs.map((port) => (
            <div key={`i:${port.name}`} className="relative text-white/45" title={port.type}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.name}
                style={{
                  left: -12,
                  background: portColor(port.type),
                  width: 9,
                  height: 9,
                  border: "2px solid #18181d",
                }}
              />
              {port.name}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {data.outputs.map((port) => (
            <div key={`o:${port.name}`} className="relative text-right text-white/45" title={port.type}>
              {port.name}
              <Handle
                type="source"
                position={Position.Right}
                id={port.name}
                style={{
                  right: -12,
                  background: portColor(port.type),
                  width: 9,
                  height: 9,
                  border: "2px solid #18181d",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfigPanel({ node, catalog, onNameChange, onConfigChange }: { node: PrimeWorldNode; catalog?: PrimeWorldNodeCatalogEntry; onNameChange: (value: string) => void; onConfigChange: (value: JsonObject) => void }) {
  const schema = catalog?.configSchema;
  const properties = (schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties : {}) as JsonObject;
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  return (
    <div>
      <div className="border-b border-white/8 pb-4">
        <p className="text-[10px] font-medium uppercase tracking-[.16em] text-violet-300/65">
          {catalog?.category ?? "节点"} · {catalog?.execution ?? "sync"}
        </p>
        <h3 className="mt-1 text-base font-semibold text-white">{catalog?.title ?? node.type}</h3>
        <p className="mt-1.5 text-xs leading-5 text-white/45">{catalog?.description ?? "配置这个节点的行为。"}</p>
      </div>
      <label className="mt-4 block">
        <span className="text-xs font-medium text-white/70">画布显示名称</span>
        <input className={inputClass} value={node.name ?? ""} placeholder={catalog?.title ?? node.type} onChange={(event) => onNameChange(event.target.value)} />
        <span className="mt-1 block text-[10px] leading-4 text-white/30">只影响画布上的名称，不会改变节点逻辑。</span>
      </label>
      {Object.keys(properties).length ? (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-white/75">节点设置</p>
            <p className="mt-1 text-[10px] text-white/30">
              <span className="text-amber-200/70">必填</span> 项需要在保存前配置。
            </p>
          </div>
          {Object.entries(properties).map(([key, field]) => (
            <SchemaField key={key} name={key} schema={field as JsonObject} value={node.config[key]} required={required.has(key)} onChange={(value) => onConfigChange({ ...node.config, [key]: value })} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg bg-white/[.035] px-3 py-2.5 text-xs leading-5 text-white/40">这个节点没有额外设置，连好输入和输出即可使用。</div>
      )}
      <details className="mt-6 border-t border-white/8 pt-4">
        <summary className="cursor-pointer select-none text-xs font-medium text-white/45 transition hover:text-white/70">高级设置 · 查看原始 JSON</summary>
        <p className="mt-2 text-[10px] leading-4 text-white/30">适合熟悉 Prime World 格式的作者。无效 JSON 不会覆盖当前配置。</p>
        <JsonValueInput
          value={node.config}
          fallback={{}}
          minHeight="min-h-44"
          onChange={(value) => {
            if (value && typeof value === "object" && !Array.isArray(value)) onConfigChange(value as JsonObject);
          }}
        />
        <p className="mt-2 break-all font-mono text-[9px] leading-4 text-white/25">
          节点 ID · {node.id}
          <br />
          类型 · {node.type}
        </p>
      </details>
    </div>
  );
}

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-white/[.035] px-3 text-xs text-white outline-none transition placeholder:text-white/20 focus:border-violet-300/45 focus:bg-white/[.055]";

const fieldCopy: Record<string, { label: string; help?: string; placeholder?: string }> = {
  path: {
    label: "状态路径",
    help: "要读取或写入的位置，例如 /story/location。",
    placeholder: "/story/location",
  },
  value: { label: "固定值", help: "节点要使用的默认数据。" },
  template: {
    label: "文本模板",
    help: "可使用 {{state.story.location}} 一类变量。",
    placeholder: "你来到了 {{state.story.location}}",
  },
  fields: {
    label: "动态字段",
    help: "每行一个字段名；保存后会出现同名输入端口。",
  },
  messages: {
    label: "预设消息",
    help: "通常在这里写 system 提示词；历史和本轮输入可从端口接入。",
  },
  textRole: { label: "本轮文本身份", help: "通常选择 user。" },
  cases: {
    label: "分支规则",
    help: "填写“匹配值: 输出端口”，例如 explore: explore。",
  },
  operation: { label: "运算方式" },
  min: { label: "最小值" },
  max: { label: "最大值" },
  integer: { label: "只生成整数" },
  mode: { label: "运行模式" },
  channel: {
    label: "历史频道",
    help: "同一条故事线使用相同频道名。",
    placeholder: "story",
  },
  role: { label: "消息身份" },
  roles: { label: "读取的消息身份", help: "选择需要送给模型的历史类型。" },
  maxEntries: { label: "最多读取条数" },
  maxTokens: { label: "最大 Token 数" },
  includeSummary: { label: "包含历史摘要" },
  thresholdTokens: { label: "摘要触发阈值" },
  instruction: {
    label: "摘要要求",
    placeholder: "保留人物、线索和未完成目标。",
  },
  keepLatest: { label: "保留最近消息数" },
  modelSlot: {
    label: "使用的模型",
    help: "main 用于正文生成，summary 用于历史摘要。",
  },
  temperature: {
    label: "创意程度",
    help: "越高越有变化；故事生成通常适合 0.7–1.0。",
  },
  outputSchema: {
    label: "输出格式约束",
    help: "JSON 模式下限定模型必须返回的字段。",
  },
  validator: { label: "故事规则校验器" },
  validatorConfig: { label: "故事规则配置" },
  elementId: { label: "界面元素 ID", help: "要更新的文本、选项等元素 ID。" },
  patch: { label: "固定修改内容" },
  actionId: { label: "操作 ID", help: "需要与界面选项的 actionId 一致。" },
  choices: { label: "选项数据" },
  view: { label: "显示界面", help: "定义玩家看到的标题、正文、选项和输入框。" },
  busy: { label: "显示忙碌状态" },
  label: { label: "提示文字" },
  message: { label: "错误提示", placeholder: "生成失败，请重试。" },
  dueInMs: { label: "延迟时间（毫秒）" },
  triggerKey: { label: "定时器标识" },
  payload: { label: "附加数据" },
  chunkCharacters: { label: "每段字符数" },
  chunkBytes: { label: "每段字节数" },
  allowedPaths: { label: "允许修改的状态路径" },
};

function SchemaField({ name, schema, value, required, onChange }: { name: string; schema: JsonObject; value: JsonValue | undefined; required: boolean; onChange: (value: JsonValue) => void }) {
  const copy = fieldCopy[name] ?? { label: humanizeFieldName(name) };
  const enums = Array.isArray(schema.enum) ? schema.enum : undefined;
  const items = schema.items && typeof schema.items === "object" && !Array.isArray(schema.items) ? (schema.items as JsonObject) : undefined;
  const itemEnums = Array.isArray(items?.enum) ? items.enum : undefined;
  const structured = schema.type === "object" || !["string", "number", "integer", "boolean", "array"].includes(String(schema.type));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`field-${name}`} className="text-xs font-medium text-white/70">
          {copy.label}
        </label>
        {required ? <span className="text-[9px] text-amber-200/65">必填</span> : <span className="text-[9px] text-white/20">可选</span>}
      </div>
      {copy.help ? <p className="mt-1 text-[10px] leading-4 text-white/35">{copy.help}</p> : null}
      {enums ? (
        <select id={`field-${name}`} className={inputClass} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {enums.map((item) => (
            <option key={String(item)} value={String(item)}>
              {enumLabel(name, String(item))}
            </option>
          ))}
        </select>
      ) : schema.type === "boolean" ? (
        <button type="button" role="switch" aria-checked={Boolean(value)} onClick={() => onChange(!Boolean(value))} className={`mt-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${value ? "border-violet-300/25 bg-violet-300/10 text-violet-100" : "border-white/10 bg-white/[.025] text-white/45"}`}>
          <span>{value ? "已开启" : "已关闭"}</span>
          <span className={`h-5 w-9 rounded-full p-0.5 transition ${value ? "bg-violet-400/70" : "bg-white/15"}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
          </span>
        </button>
      ) : schema.type === "array" && itemEnums ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {itemEnums.map((item) => {
            const active = Array.isArray(value) && value.includes(item);
            return (
              <button type="button" key={String(item)} onClick={() => onChange(active ? (value as JsonValue[]).filter((entry) => entry !== item) : [...(Array.isArray(value) ? value : []), item])} className={`rounded-md border px-2 py-1.5 text-left text-[10px] transition ${active ? "border-violet-300/30 bg-violet-300/10 text-violet-100" : "border-white/8 text-white/40 hover:border-white/15"}`}>
                {enumLabel(name, String(item))}
              </button>
            );
          })}
        </div>
      ) : schema.type === "array" && items?.type === "string" ? (
        <textarea
          id={`field-${name}`}
          className={`${inputClass} h-auto min-h-24 py-2 leading-5`}
          placeholder="每行填写一项"
          value={Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : ""}
          onChange={(event) =>
            onChange(
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      ) : structured || schema.type === "array" ? (
        <JsonValueInput value={value} fallback={schema.type === "array" ? [] : {}} onChange={onChange} />
      ) : (
        <input id={`field-${name}`} className={inputClass} type={schema.type === "number" || schema.type === "integer" ? "number" : "text"} min={typeof schema.minimum === "number" ? schema.minimum : undefined} max={typeof schema.maximum === "number" ? schema.maximum : undefined} placeholder={copy.placeholder} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => onChange(schema.type === "number" || schema.type === "integer" ? Number(event.target.value) : event.target.value)} />
      )}
    </div>
  );
}

function JsonValueInput({ value, fallback, onChange, minHeight = "min-h-32" }: { value: JsonValue | undefined; fallback: JsonValue; onChange: (value: JsonValue) => void; minHeight?: string }) {
  const serialized = JSON.stringify(value ?? fallback, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(serialized);
    setInvalid(false);
  }, [serialized]);
  return (
    <div className="mt-2">
      <textarea
        className={`${minHeight} w-full resize-y rounded-lg border bg-black/25 p-2.5 font-mono text-[10px] leading-4 outline-none transition ${invalid ? "border-red-300/35 text-red-100" : "border-white/10 text-white/70 focus:border-violet-300/35"}`}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            onChange(JSON.parse(next) as JsonValue);
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid ? <p className="mt-1 text-[10px] text-red-300/70">JSON 格式还不完整，修正后才会应用。</p> : null}
    </div>
  );
}

function humanizeFieldName(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
}
function enumLabel(name: string, value: string) {
  const labels: Record<string, string> = {
    text: "纯文本",
    json: "结构化 JSON",
    main: "正文模型",
    summary: "摘要模型",
    user: "玩家",
    assistant: "助手",
    narrator: "旁白",
    system: "系统",
    tool: "工具",
    paths: "按路径修改",
    "immersive-novel-v1": "沉浸式故事",
    all: "等待全部",
    any: "任一完成",
    batch: "完整生成",
    stream: "流式生成",
    eq: "等于",
    ne: "不等于",
    gt: "大于",
    gte: "大于等于",
    lt: "小于",
    lte: "小于等于",
    add: "相加",
    subtract: "相减",
    multiply: "相乘",
    divide: "相除",
    min: "取较小值",
    max: "取较大值",
  };
  return labels[value] ? `${labels[value]} · ${value}` : value;
}

function JsonEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          json(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callback.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "#0b0b0d",
              color: "#e5e7eb",
            },
            ".cm-content": {
              fontFamily: "ui-monospace, monospace",
              fontSize: "12px",
            },
            ".cm-gutters": {
              backgroundColor: "#0b0b0d",
              color: "#555",
              border: "none",
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}

function defaultConfig(schema: JsonObject) {
  const properties = (schema.properties ?? {}) as JsonObject;
  const result: JsonObject = {};
  for (const [key, raw] of Object.entries(properties)) {
    const field = raw as JsonObject;
    if (field.default !== undefined) result[key] = field.default;
    else if (Array.isArray(field.enum) && field.enum.length) result[key] = field.enum[0]!;
    else if (field.type === "string") result[key] = "";
    else if (field.type === "boolean") result[key] = false;
    else if (field.type === "number" || field.type === "integer") result[key] = Number(field.minimum ?? 0);
    else if (field.type === "array") result[key] = [];
    else if (field.type === "object") result[key] = {};
  }
  return result;
}
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
  if (node.type === "data.object" && Array.isArray(node.config.fields)) for (const field of node.config.fields) if (typeof field === "string") add(inputs, field, "json");
  return { inputs, outputs };
}
function portColor(type: string) {
  return type === "control" ? "#a78bfa" : type.endsWith("stream") ? "#f59e0b" : type === "audio" ? "#ec4899" : "#38bdf8";
}
function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs ${active ? "bg-white text-black" : "text-white/55"}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
