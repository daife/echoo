import { primeWorldViewSchema } from "@echoo/shared";
import type {
  JsonObject,
  PrimeWorldDetail,
  PrimeWorldEdge,
  PrimeWorldNode,
  PrimeWorldPortType,
  PrimeWorldValidationIssue,
} from "@echoo/shared";

type NodeSpec = {
  inputs: Record<string, PrimeWorldPortType>;
  outputs: Record<string, PrimeWorldPortType>;
  sideEffect?: boolean;
  validate?: (node: PrimeWorldNode) => void;
};

const control = "control" as const;
const json = "json" as const;
const text = "text" as const;
const number = "number" as const;

export const primeWorldNodeCatalog: Record<string, NodeSpec> = {
  "trigger.worldStart": { inputs: {}, outputs: { control, event: "event" } },
  "trigger.uiAction": {
    inputs: {},
    outputs: { control, actionId: text, payload: json },
  },
  "trigger.textInput": { inputs: {}, outputs: { control, text } },
  "trigger.voiceInput": {
    inputs: {},
    outputs: { control, audio: "audio", transcript: text },
  },
  "trigger.timer": { inputs: {}, outputs: { control, payload: json } },
  "state.get": { inputs: {}, outputs: { value: json }, validate: requirePath },
  "state.set": {
    inputs: { control, value: json },
    outputs: { control },
    sideEffect: true,
    validate: requirePath,
  },
  "data.constant": { inputs: {}, outputs: { value: json } },
  "data.template": {
    inputs: { control },
    outputs: { control, text },
    validate: requireTemplate,
  },
  "data.pick": {
    inputs: { source: json },
    outputs: { value: json },
    validate: requirePath,
  },
  "data.object": { inputs: { control }, outputs: { control, value: json } },
  "logic.if": {
    inputs: { control, value: json },
    outputs: { true: control, false: control },
  },
  "logic.switch": {
    inputs: { control, value: json },
    outputs: { default: control },
    validate: validateSwitch,
  },
  "math.operation": {
    inputs: { control, left: number, right: number },
    outputs: { control, value: number },
    validate: validateMath,
  },
  "math.random": { inputs: { control }, outputs: { control, value: number } },
  "history.append": {
    inputs: { control, content: json },
    outputs: { control },
    sideEffect: true,
  },
  "view.render": {
    inputs: { control, view: "view" },
    outputs: { control, view: "view" },
    sideEffect: true,
    validate: validateView,
  },
  "view.patch": {
    inputs: { control },
    outputs: { control, view: "view" },
    sideEffect: true,
    validate: requireElementId,
  },
  "flow.noop": { inputs: { control }, outputs: { control } },
};

export interface CompiledPrimeWorld {
  nodes: Map<string, PrimeWorldNode>;
  outgoing: Map<string, PrimeWorldEdge[]>;
  incoming: Map<string, PrimeWorldEdge[]>;
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
    const spec = primeWorldNodeCatalog[node.type];
    if (!spec || node.version !== 1)
      throw issue(
        "UNSUPPORTED_NODE",
        `/workflow/nodes/${index}`,
        `不支持节点 ${node.type}@${node.version}。`,
        node.id,
      );
    try {
      spec.validate?.(node);
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
        : sourcePort !== control && sourcePort === targetPort;
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

  const reachable = new Set<string>();
  for (const trigger of [...nodes.values()].filter((node) =>
    node.type.startsWith("trigger."),
  )) {
    const visiting = new Set<string>();
    visitControl(trigger.id, outgoing, visiting, reachable);
  }
  for (const node of nodes.values())
    if (primeWorldNodeCatalog[node.type]?.sideEffect && !reachable.has(node.id))
      throw issue(
        "UNREACHABLE_SIDE_EFFECT",
        `/workflow/nodes/${node.id}`,
        "副作用节点无法从任何触发器到达。",
        node.id,
      );
  return { nodes, outgoing, incoming };
}

function portType(
  node: PrimeWorldNode,
  direction: "input" | "output",
  port: string,
) {
  if (direction === "output" && node.type === "logic.switch") {
    const cases = node.config.cases;
    if (
      cases &&
      typeof cases === "object" &&
      !Array.isArray(cases) &&
      Object.values(cases).includes(port)
    )
      return control;
  }
  const spec = primeWorldNodeCatalog[node.type]!;
  return (direction === "input" ? spec.inputs : spec.outputs)[port];
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

function requirePath(node: PrimeWorldNode) {
  if (typeof node.config.path !== "string" || !node.config.path.trim())
    throw new Error("path 必须是非空字符串。");
}
function requireTemplate(node: PrimeWorldNode) {
  if (typeof node.config.template !== "string")
    throw new Error("template 必须是字符串。");
}
function requireElementId(node: PrimeWorldNode) {
  if (
    typeof node.config.elementId !== "string" ||
    !node.config.elementId.trim()
  )
    throw new Error("elementId 必须是非空字符串。");
}
function validateView(node: PrimeWorldNode) {
  const result = primeWorldViewSchema.safeParse(node.config.view);
  if (!result.success)
    throw new Error(result.error.issues[0]?.message ?? "view 配置无效。");
}
function validateMath(node: PrimeWorldNode) {
  if (
    !["add", "subtract", "multiply", "divide", "min", "max"].includes(
      String(node.config.operation ?? ""),
    )
  )
    throw new Error("不支持的数学操作。");
}
function validateSwitch(node: PrimeWorldNode) {
  const cases = node.config.cases;
  if (!cases || typeof cases !== "object" || Array.isArray(cases))
    throw new Error("cases 必须是匹配值到输出端口的对象。");
  for (const port of Object.values(cases))
    if (typeof port !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(port))
      throw new Error("switch 输出端口名称无效。");
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
