import { primeWorldViewSchema } from "@echoo/shared";
import Ajv from "ajv";
import type {
  JsonObject,
  PrimeWorldDetail,
  PrimeWorldEdge,
  PrimeWorldNode,
  PrimeWorldValidationIssue,
} from "@echoo/shared";
import {
  primeWorldNodeRegistry,
  resolvePrimeWorldPort,
} from "./prime-world-node-registry.js";
import {
  assertSafePrimeWorldJsonSchema,
  compilePrimeWorldJsonSchema,
} from "./prime-world-json-schema.js";
import type { ValidateFunction } from "ajv";

export const primeWorldNodeCatalog = primeWorldNodeRegistry;
const configAjv = new Ajv({ allErrors: true, strict: false });
const control = "control" as const;

export interface CompiledPrimeWorld {
  nodes: Map<string, PrimeWorldNode>;
  outgoing: Map<string, PrimeWorldEdge[]>;
  incoming: Map<string, PrimeWorldEdge[]>;
  stateValidator?: ValidateFunction;
}

export function compilePrimeWorld(
  detail: PrimeWorldDetail,
): CompiledPrimeWorld {
  if (detail.schemaVersion !== 1 || detail.workflow.version !== 1)
    throw issue(
      "UNSUPPORTED_VERSION",
      "/schemaVersion",
      "不支持的本初世界定义版本。",
    );
  const startView = primeWorldViewSchema.safeParse(detail.presentation.startView);
  if (!startView.success)
    throw issue(
      "INVALID_START_VIEW",
      "/presentation/startView",
      startView.error.issues[0]?.message ?? "初始视图无效。",
    );
  if (Buffer.byteLength(JSON.stringify(detail.presentation.startView), "utf8") > 128 * 1024)
    throw issue("VIEW_QUOTA_EXCEEDED", "/presentation/startView", "初始 WorldView 不能超过 128 KiB。");
  if (Buffer.byteLength(JSON.stringify(detail.initialState), "utf8") > 256 * 1024)
    throw issue("STATE_QUOTA_EXCEEDED", "/initialState", "初始状态不能超过 256 KiB。");
  let stateValidator: ValidateFunction | undefined;
  if (detail.stateSchema) {
    try {
      assertSafePrimeWorldJsonSchema(detail.stateSchema);
      stateValidator = compilePrimeWorldJsonSchema(detail.stateSchema);
      if (!stateValidator(detail.initialState))
        throw new Error("initialState 不符合 stateSchema。");
    } catch (error) {
      throw issue(
        "INVALID_STATE_SCHEMA",
        "/stateSchema",
        error instanceof Error ? error.message : "状态 schema 无效。",
      );
    }
  }
  if (detail.workflow.nodes.length > 200 || detail.workflow.edges.length > 400)
    throw issue(
      "GRAPH_QUOTA_EXCEEDED",
      "/workflow",
      "工作流最多包含 200 个节点和 400 条边。",
    );

  const nodes = new Map<string, PrimeWorldNode>();
  for (const [index, node] of detail.workflow.nodes.entries()) {
    if (nodes.has(node.id))
      throw issue(
        "DUPLICATE_NODE",
        `/workflow/nodes/${index}/id`,
        "节点 ID 重复。",
        node.id,
      );
    const spec = primeWorldNodeRegistry[node.type];
    if (!spec || node.version !== 1)
      throw issue(
        "UNSUPPORTED_NODE",
        `/workflow/nodes/${index}`,
        `不支持节点 ${node.type}@${node.version}。`,
        node.id,
      );
    try {
      const validateConfig = configAjv.compile(spec.configSchema);
      if (!validateConfig(node.config))
        throw new Error(
          validateConfig.errors?.[0]?.message ?? "节点配置不符合 schema。",
        );
      spec.validate?.(node);
      if (node.type === "ai.llm" && node.config.mode === "json") {
        const schema = node.config.outputSchema;
        if (!schema || typeof schema !== "object" || Array.isArray(schema))
          throw new Error("JSON 模式必须配置 outputSchema。");
        assertSafePrimeWorldJsonSchema(schema as JsonObject);
      }
    } catch (error) {
      if (error instanceof PrimeWorldCompileError) throw error;
      throw issue(
        "INVALID_NODE_CONFIG",
        `/workflow/nodes/${index}/config`,
        error instanceof Error ? error.message : "节点配置无效。",
        node.id,
      );
    }
    nodes.set(node.id, node);
  }
  if (![...nodes.values()].some((node) => node.type.startsWith("trigger.")))
    throw issue(
      "MISSING_TRIGGER",
      "/workflow/nodes",
      "工作流至少需要一个触发器。",
    );

  const outgoing = new Map<string, PrimeWorldEdge[]>();
  const incoming = new Map<string, PrimeWorldEdge[]>();
  const edgeIds = new Set<string>();
  for (const [index, edge] of detail.workflow.edges.entries()) {
    const pointer = `/workflow/edges/${index}`;
    if (edgeIds.has(edge.id))
      throw issue("DUPLICATE_EDGE", `${pointer}/id`, "边 ID 重复。");
    edgeIds.add(edge.id);
    const source = nodes.get(edge.source.nodeId);
    const target = nodes.get(edge.target.nodeId);
    if (!source || !target)
      throw issue("UNKNOWN_NODE", pointer, "边引用了不存在的节点。");
    const sourcePort = portType(source, "output", edge.source.port);
    const targetPort = portType(target, "input", edge.target.port);
    if (!sourcePort)
      throw issue(
        "UNKNOWN_PORT",
        `${pointer}/source/port`,
        "源端口不存在。",
        source.id,
        edge.source.port,
      );
    if (!targetPort)
      throw issue(
        "UNKNOWN_PORT",
        `${pointer}/target/port`,
        "目标端口不存在。",
        target.id,
        edge.target.port,
      );
    const valid =
      edge.kind === "control"
        ? sourcePort === control && targetPort === control
        : isAssignablePort(sourcePort, targetPort);
    if (!valid)
      throw issue(
        "PORT_TYPE_MISMATCH",
        pointer,
        "边的端口类型不匹配。",
        target.id,
        edge.target.port,
      );
    const outgoingKey = `${source.id}:${edge.source.port}`;
    const incomingKey = `${target.id}:${edge.target.port}`;
    outgoing.set(outgoingKey, [...(outgoing.get(outgoingKey) ?? []), edge]);
    incoming.set(incomingKey, [...(incoming.get(incomingKey) ?? []), edge]);
    if (edge.kind === "data" && (incoming.get(incomingKey)?.length ?? 0) > 1)
      throw issue(
        "MULTIPLE_DATA_SOURCES",
        `${pointer}/target`,
        "单值数据端口只能连接一个来源。",
        target.id,
        edge.target.port,
      );
  }

  for (const node of nodes.values()) {
    const spec = primeWorldNodeRegistry[node.type]!;
    for (const port of spec.inputs) {
      if (!port.required || port.type === "control" || port.multiple) continue;
      if (incoming.has(`${node.id}:${port.name}`)) continue;
      if (Object.prototype.hasOwnProperty.call(node.config, port.name)) continue;
      throw issue(
        "MISSING_REQUIRED_INPUT",
        `/workflow/nodes/${node.id}`,
        `必需输入 ${port.name} 没有数据来源。`,
        node.id,
        port.name,
      );
    }
    if (node.type === "data.object")
      for (const field of Array.isArray(node.config.fields) ? node.config.fields : [])
        if (!incoming.has(`${node.id}:${String(field)}`))
          throw issue(
            "MISSING_REQUIRED_INPUT",
            `/workflow/nodes/${node.id}/config/fields`,
            `动态字段 ${String(field)} 没有数据来源。`,
            node.id,
            String(field),
          );
  }
  const externalCalls = [...nodes.values()].filter((node) =>
    ["ai.llm", "history.summarize", "audio.stt", "audio.tts"].includes(node.type),
  ).length;
  if (externalCalls > 8)
    throw issue("EXTERNAL_CALL_QUOTA_EXCEEDED", "/workflow/nodes", "单次可达工作流最多包含 8 个外部调用节点。");
  for (const node of nodes.values()) {
    const spec = primeWorldNodeRegistry[node.type]!;
    const producesStream =
      node.type.startsWith("convert.") ||
      (node.type === "audio.tts" && node.config.mode === "stream") ||
      (node.type === "ai.llm" && node.config.mode === "text");
    for (const port of spec.outputs.filter((item) => item.type.endsWith("-stream") && producesStream))
      if (!(outgoing.get(`${node.id}:${port.name}`) ?? []).some((edge) => edge.kind === "data"))
        throw issue("STREAM_WITHOUT_SINK", `/workflow/nodes/${node.id}`, `流输出 ${port.name} 必须连接至少一个 sink。`, node.id, port.name);
    if (node.type === "flow.fork" && ![...outgoing.entries()].some(([key, edges]) => key.startsWith(`${node.id}:branch`) && edges.some((edge) => edge.kind === "control")))
      throw issue("FORK_WITHOUT_BRANCH", `/workflow/nodes/${node.id}`, "fork 至少需要一个已连接分支。", node.id);
  }

  const reachable = new Set<string>();
  for (const trigger of [...nodes.values()].filter((node) =>
    node.type.startsWith("trigger."),
  )) {
    const visiting = new Set<string>();
    visitControl(trigger.id, outgoing, visiting, reachable);
  }
  for (const node of nodes.values())
    if (primeWorldNodeRegistry[node.type]?.sideEffect && !reachable.has(node.id))
      throw issue(
        "UNREACHABLE_SIDE_EFFECT",
        `/workflow/nodes/${node.id}`,
        "副作用节点无法从任何触发器到达。",
        node.id,
      );
  validateForkBranches(nodes, outgoing);
  return { nodes, outgoing, incoming, ...(stateValidator ? { stateValidator } : {}) };
}

function isAssignablePort(source: ReturnType<typeof resolvePrimeWorldPort>, target: ReturnType<typeof resolvePrimeWorldPort>) {
  if (!source || !target || source === "control" || target === "control") return false;
  if (source === target) return true;
  if (target === "json")
    return ["text", "number", "boolean", "messages", "state-patch", "event", "view"].includes(source);
  return false;
}

export function validatePrimeWorldDefinition(detail: PrimeWorldDetail) {
  const issues: PrimeWorldValidationIssue[] = [];
  const add = (next: PrimeWorldValidationIssue) => {
    if (!issues.some((item) => item.code === next.code && item.pointer === next.pointer && item.nodeId === next.nodeId && item.port === next.port)) issues.push(next);
  };
  const ids = new Set<string>();
  detail.workflow.nodes.forEach((node, index) => {
    if (ids.has(node.id)) add({ code: "DUPLICATE_NODE", message: "节点 ID 重复。", pointer: `/workflow/nodes/${index}/id`, nodeId: node.id });
    ids.add(node.id);
    const spec = primeWorldNodeRegistry[node.type];
    if (!spec || node.version !== 1) {
      add({ code: "UNSUPPORTED_NODE", message: `不支持节点 ${node.type}@${node.version}。`, pointer: `/workflow/nodes/${index}`, nodeId: node.id });
      return;
    }
    try {
      const validateConfig = configAjv.compile(spec.configSchema);
      if (!validateConfig(node.config)) throw new Error(validateConfig.errors?.[0]?.message ?? "节点配置不符合 schema。");
      spec.validate?.(node);
      if (node.type === "ai.llm" && node.config.mode === "json") {
        if (!node.config.outputSchema || typeof node.config.outputSchema !== "object" || Array.isArray(node.config.outputSchema)) throw new Error("JSON 模式必须配置 outputSchema。");
        assertSafePrimeWorldJsonSchema(node.config.outputSchema as JsonObject);
      }
    } catch (error) {
      add({ code: "INVALID_NODE_CONFIG", message: error instanceof Error ? error.message : "节点配置无效。", pointer: `/workflow/nodes/${index}/config`, nodeId: node.id });
    }
  });
  const nodeMap = new Map(detail.workflow.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set<string>();
  const incoming = new Map<string, number>();
  detail.workflow.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) add({ code: "DUPLICATE_EDGE", message: "边 ID 重复。", pointer: `/workflow/edges/${index}/id` });
    edgeIds.add(edge.id);
    const source = nodeMap.get(edge.source.nodeId);
    const target = nodeMap.get(edge.target.nodeId);
    if (!source || !target) {
      add({ code: "UNKNOWN_NODE", message: "边引用了不存在的节点。", pointer: `/workflow/edges/${index}` });
      return;
    }
    const sourcePort = resolvePrimeWorldPort(source, "output", edge.source.port);
    const targetPort = resolvePrimeWorldPort(target, "input", edge.target.port);
    if (!sourcePort) add({ code: "UNKNOWN_PORT", message: "源端口不存在。", pointer: `/workflow/edges/${index}/source/port`, nodeId: source.id, port: edge.source.port });
    if (!targetPort) add({ code: "UNKNOWN_PORT", message: "目标端口不存在。", pointer: `/workflow/edges/${index}/target/port`, nodeId: target.id, port: edge.target.port });
    if (sourcePort && targetPort && (edge.kind === "control" ? !(sourcePort === "control" && targetPort === "control") : !isAssignablePort(sourcePort, targetPort)))
      add({ code: "PORT_TYPE_MISMATCH", message: "边的端口类型不匹配。", pointer: `/workflow/edges/${index}`, nodeId: target.id, port: edge.target.port });
    if (edge.kind === "data") {
      const key = `${target.id}:${edge.target.port}`;
      incoming.set(key, (incoming.get(key) ?? 0) + 1);
      if ((incoming.get(key) ?? 0) > 1) add({ code: "MULTIPLE_DATA_SOURCES", message: "单值数据端口只能连接一个来源。", pointer: `/workflow/edges/${index}/target`, nodeId: target.id, port: edge.target.port });
    }
  });
  for (const node of nodeMap.values()) {
    const spec = primeWorldNodeRegistry[node.type];
    if (!spec) continue;
    for (const port of spec.inputs)
      if (port.required && port.type !== "control" && !port.multiple && !incoming.has(`${node.id}:${port.name}`) && !Object.prototype.hasOwnProperty.call(node.config, port.name))
        add({ code: "MISSING_REQUIRED_INPUT", message: `必需输入 ${port.name} 没有数据来源。`, pointer: `/workflow/nodes/${node.id}`, nodeId: node.id, port: port.name });
  }
  try {
    compilePrimeWorld(detail);
  } catch (error) {
    const next = error instanceof PrimeWorldCompileError ? error.validationIssue : { code: "WORKFLOW_INVALID", message: error instanceof Error ? error.message : "工作流无效。", pointer: "/" };
    add(next);
  }
  return issues;
}

function portType(
  node: PrimeWorldNode,
  direction: "input" | "output",
  port: string,
) {
  return resolvePrimeWorldPort(node, direction, port);
}

function visitControl(
  id: string,
  outgoing: CompiledPrimeWorld["outgoing"],
  visiting: Set<string>,
  visited: Set<string>,
) {
  if (visiting.has(id))
    throw issue(
      "CONTROL_CYCLE",
      "/workflow/edges",
      "单次运行的控制图不能包含环。",
      id,
    );
  if (visited.has(id)) return;
  visiting.add(id);
  for (const [key, edges] of outgoing)
    if (key.startsWith(`${id}:`))
      for (const edge of edges)
        if (edge.kind === "control")
          visitControl(edge.target.nodeId, outgoing, visiting, visited);
  visiting.delete(id);
  visited.add(id);
}

function validateForkBranches(
  nodes: Map<string, PrimeWorldNode>,
  outgoing: CompiledPrimeWorld["outgoing"],
) {
  for (const fork of [...nodes.values()].filter((node) => node.type === "flow.fork")) {
    const starts = [...outgoing.entries()]
      .filter(([key]) => key.startsWith(`${fork.id}:`))
      .flatMap(([, edges]) => edges.filter((edge) => edge.kind === "control").map((edge) => edge.target.nodeId));
    const branches = starts.map((start) => collectBranch(start, nodes, outgoing));
    for (let left = 0; left < branches.length; left++)
      for (let right = left + 1; right < branches.length; right++) {
        const a = branches[left]!;
        const b = branches[right]!;
        const implicitMerge = [...a.visited].find((id) => b.visited.has(id) && nodes.get(id)?.type !== "flow.join");
        if (implicitMerge)
          throw issue("PARALLEL_JOIN_REQUIRED", `/workflow/nodes/${fork.id}`, "fork 分支必须通过 flow.join 显式汇合。", implicitMerge);
        const conflict = [...a.writes].find((path) => [...b.writes].some((other) => pathsOverlap(path, other)));
        if (conflict)
          throw issue("PARALLEL_WRITE_CONFLICT", `/workflow/nodes/${fork.id}`, `fork 分支存在并行写冲突：${conflict}。`, fork.id);
      }
  }
}

function collectBranch(
  start: string,
  nodes: Map<string, PrimeWorldNode>,
  outgoing: CompiledPrimeWorld["outgoing"],
) {
  const visited = new Set<string>();
  const writes = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    const node = nodes.get(id);
    if (!node || node.type === "flow.join") continue;
    visited.add(id);
    for (const path of nodeWritePaths(node)) writes.add(path);
    for (const [key, edges] of outgoing)
      if (key.startsWith(`${id}:`))
        for (const edge of edges)
          if (edge.kind === "control") queue.push(edge.target.nodeId);
  }
  return { visited, writes };
}

function nodeWritePaths(node: PrimeWorldNode) {
  if (node.type === "state.set") return [normalizeWritePath(String(node.config.path))];
  if (node.type === "state.patch")
    return node.config.mode === "immersive-novel-v1"
      ? ["/state/story"]
      : (Array.isArray(node.config.allowedPaths) ? node.config.allowedPaths : []).map((path) => normalizeWritePath(String(path)));
  if (node.type === "state.saveSummary") return [`/summary/${String(node.config.channel)}`];
  if (["view.render", "view.patch", "view.showChoices", "view.setBusy"].includes(node.type)) return ["/view"];
  if (node.type.startsWith("timer.")) return [`/timer/${String(node.config.triggerKey)}`];
  return [];
}

function normalizeWritePath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.startsWith("/state/") ? normalized : `/state${normalized}`;
}

function pathsOverlap(left: string, right: string) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function issue(
  code: string,
  pointer: string,
  message: string,
  nodeId?: string,
  port?: string,
) {
  return new PrimeWorldCompileError({
    code,
    pointer,
    message,
    ...(nodeId ? { nodeId } : {}),
    ...(port ? { port } : {}),
  });
}

export class PrimeWorldCompileError extends Error {
  readonly pointer: string;
  readonly code: string;
  readonly nodeId?: string;
  readonly port?: string;
  constructor(readonly validationIssue: PrimeWorldValidationIssue) {
    super(validationIssue.message);
    this.name = "PrimeWorldCompileError";
    this.pointer = validationIssue.pointer;
    this.code = validationIssue.code;
    this.nodeId = validationIssue.nodeId;
    this.port = validationIssue.port;
  }
}
