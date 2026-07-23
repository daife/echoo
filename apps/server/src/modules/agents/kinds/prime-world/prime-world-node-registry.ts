import type {
  JsonObject,
  PrimeWorldNode,
  PrimeWorldNodeCatalogEntry,
  PrimeWorldPortDefinition,
  PrimeWorldPortType,
  WorldView,
  WorldViewElement,
} from "@echoo/shared";

export interface PrimeWorldNodeSpec extends PrimeWorldNodeCatalogEntry {
  sideEffect?: boolean;
  validate?: (node: PrimeWorldNode) => void;
  resourceIds?: (node: PrimeWorldNode) => string[];
}

const p = (
  name: string,
  type: PrimeWorldPortType,
  required = false,
  multiple = false,
): PrimeWorldPortDefinition => ({ name, type, ...(required ? { required } : {}), ...(multiple ? { multiple } : {}) });
const control = p("control", "control", true);
const emptySchema = { type: "object", properties: {}, additionalProperties: false } satisfies JsonObject;
const objectSchema = (properties: JsonObject, required: string[] = []): JsonObject => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const stringSchema = (extra: JsonObject = {}): JsonObject => ({ type: "string", ...extra });
const numberSchema = (extra: JsonObject = {}): JsonObject => ({ type: "number", ...extra });
const booleanSchema: JsonObject = { type: "boolean" };

function spec(input: Omit<PrimeWorldNodeSpec, "version">): PrimeWorldNodeSpec {
  return { version: 1, ...input };
}

export const primeWorldNodeRegistry: Record<string, PrimeWorldNodeSpec> = Object.fromEntries(
  [
    spec({ type: "trigger.worldStart", title: "世界开始", description: "首次进入或重置后触发", category: "trigger", execution: "sync", configSchema: emptySchema, inputs: [], outputs: [p("control", "control"), p("event", "event")] }),
    spec({ type: "trigger.uiAction", title: "界面操作", description: "接收受控 UI action", category: "trigger", execution: "sync", configSchema: emptySchema, inputs: [], outputs: [p("control", "control"), p("actionId", "text"), p("payload", "json")] }),
    spec({ type: "trigger.textInput", title: "文本输入", description: "接收世界文本输入", category: "trigger", execution: "sync", configSchema: emptySchema, inputs: [], outputs: [p("control", "control"), p("text", "text")] }),
    spec({ type: "trigger.voiceInput", title: "语音输入", description: "接收已上传的完整音频", category: "trigger", execution: "sync", configSchema: emptySchema, inputs: [], outputs: [p("control", "control"), p("audio", "audio")] }),
    spec({ type: "trigger.timer", title: "定时器", description: "接收到期事件", category: "trigger", execution: "sync", configSchema: emptySchema, inputs: [], outputs: [p("control", "control"), p("triggerKey", "text"), p("payload", "json")] }),
    spec({ type: "state.get", title: "读取状态", description: "按安全路径读取变量", category: "state", execution: "sync", configSchema: objectSchema({ path: stringSchema() }, ["path"]), inputs: [], outputs: [p("value", "json")], validate: requirePath }),
    spec({ type: "state.set", title: "写入状态", description: "写入单个变量路径", category: "state", execution: "sync", configSchema: objectSchema({ path: stringSchema(), value: {} }, ["path"]), inputs: [control, p("value", "json")], outputs: [p("control", "control")], sideEffect: true, validate: requirePath }),
    spec({ type: "state.patch", title: "合并状态", description: "应用受限 JSON merge patch", category: "state", execution: "sync", configSchema: objectSchema({ mode: stringSchema({ enum: ["paths", "immersive-novel-v1"], default: "paths" }), allowedPaths: { type: "array", items: stringSchema(), maxItems: 100, default: [] }, validatorConfig: { type: "object", properties: {}, additionalProperties: true } }), inputs: [control, p("patch", "json", true)], outputs: [p("control", "control"), p("invalid", "control")], sideEffect: true }),
    spec({ type: "state.saveSummary", title: "保存摘要", description: "保存频道摘要和游标", category: "state", execution: "sync", configSchema: objectSchema({ channel: stringSchema() }, ["channel"]), inputs: [control, p("summary", "json", true)], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "data.constant", title: "常量", description: "产生 JSON 常量", category: "data", execution: "sync", configSchema: objectSchema({ value: {} }), inputs: [], outputs: [p("value", "json")] }),
    spec({ type: "data.template", title: "文本模板", description: "安全路径插值", category: "data", execution: "sync", configSchema: objectSchema({ template: stringSchema() }, ["template"]), inputs: [p("control", "control")], outputs: [p("control", "control"), p("text", "text")], validate: requireTemplate }),
    spec({ type: "data.pick", title: "提取字段", description: "按路径读取 JSON", category: "data", execution: "sync", configSchema: objectSchema({ path: stringSchema() }, ["path"]), inputs: [p("source", "json", true)], outputs: [p("value", "json")], validate: requirePath }),
    spec({ type: "data.object", title: "构造对象", description: "用配置和动态输入字段构造 JSON 对象", category: "data", execution: "sync", configSchema: objectSchema({ value: {}, fields: { type: "array", items: stringSchema({ pattern: "^[A-Za-z_][A-Za-z0-9_-]*$" }), maxItems: 100, default: [] } }), inputs: [p("control", "control")], outputs: [p("control", "control"), p("value", "json")], validate: validateObjectFields }),
    spec({ type: "data.messages", title: "组装消息", description: "构造有序 LLM messages", category: "data", execution: "sync", configSchema: objectSchema({ messages: { type: "array", items: { type: "object", properties: {}, additionalProperties: true } }, textRole: stringSchema({ enum: ["system", "user", "assistant"] }) }), inputs: [p("control", "control"), p("history", "messages"), p("text", "text")], outputs: [p("control", "control"), p("messages", "messages")] }),
    spec({ type: "data.normalizeAction", title: "规范行动", description: "统一文本与选项操作", category: "data", execution: "sync", configSchema: emptySchema, inputs: [control, p("event", "event")], outputs: [p("control", "control"), p("action", "json")] }),
    spec({ type: "data.toText", title: "转为文本", description: "显式标量转文本", category: "data", execution: "sync", configSchema: emptySchema, inputs: [control, p("value", "json", true)], outputs: [p("control", "control"), p("text", "text")] }),
    spec({ type: "logic.if", title: "条件", description: "相等比较分支", category: "logic", execution: "sync", configSchema: objectSchema({ value: {}, equals: {} }), inputs: [control, p("value", "json", true)], outputs: [p("true", "control"), p("false", "control")] }),
    spec({ type: "logic.switch", title: "分支", description: "枚举多路分支", category: "logic", execution: "sync", configSchema: objectSchema({ value: {}, cases: { type: "object", properties: {}, additionalProperties: true } }, ["cases"]), inputs: [control, p("value", "json", true)], outputs: [p("default", "control")], validate: validateSwitch }),
    spec({ type: "logic.compare", title: "比较", description: "比较标量", category: "logic", execution: "sync", configSchema: objectSchema({ operation: stringSchema({ enum: ["eq", "ne", "gt", "gte", "lt", "lte"] }) }, ["operation"]), inputs: [control, p("left", "json", true), p("right", "json", true)], outputs: [p("control", "control"), p("value", "boolean")] }),
    spec({ type: "logic.math", title: "数学", description: "有限数值运算", category: "logic", execution: "sync", configSchema: objectSchema({ operation: stringSchema({ enum: ["add", "subtract", "multiply", "divide", "min", "max"] }) }, ["operation"]), inputs: [control, p("left", "number", true), p("right", "number", true)], outputs: [p("control", "control"), p("value", "number")], validate: validateMath }),
    spec({ type: "logic.random", title: "随机", description: "产生有界随机数", category: "logic", execution: "sync", configSchema: objectSchema({ min: numberSchema(), max: numberSchema(), integer: booleanSchema }), inputs: [control], outputs: [p("control", "control"), p("value", "number")] }),
    spec({ type: "flow.noop", title: "空操作", description: "控制流占位", category: "flow", execution: "sync", configSchema: emptySchema, inputs: [control], outputs: [p("control", "control")] }),
    spec({ type: "flow.fork", title: "并行分叉", description: "启动所有已连接分支", category: "flow", execution: "sync", configSchema: emptySchema, inputs: [control], outputs: [p("branch", "control", false, true)] }),
    spec({ type: "flow.join", title: "并行汇合", description: "等待全部或任一分支", category: "flow", execution: "async", configSchema: objectSchema({ mode: stringSchema({ enum: ["all", "any"] }) }, ["mode"]), inputs: [p("in", "control", true, true)], outputs: [p("control", "control")] }),
    spec({ type: "timer.schedule", title: "登记定时器", description: "成功提交后登记未来事件", category: "flow", execution: "sync", configSchema: objectSchema({ triggerKey: stringSchema(), dueInMs: { type: "integer", minimum: 1, maximum: 31_536_000_000 }, payload: {} }, ["triggerKey", "dueInMs"]), inputs: [control], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "timer.cancel", title: "取消定时器", description: "按 trigger key 取消", category: "flow", execution: "sync", configSchema: objectSchema({ triggerKey: stringSchema() }, ["triggerKey"]), inputs: [control], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "history.append", title: "追加历史", description: "向频道追加历史项", category: "history", execution: "sync", configSchema: objectSchema({ channel: stringSchema(), role: stringSchema({ enum: ["system", "user", "assistant", "narrator", "tool"] }), content: {} }, ["channel", "role"]), inputs: [control, p("content", "json")], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "history.read", title: "读取历史", description: "按角色和 token 窗口读取", category: "history", execution: "async", configSchema: objectSchema({ channel: stringSchema(), roles: { type: "array", items: stringSchema(), minItems: 1, maxItems: 5 }, maxEntries: { type: "integer", minimum: 1, maximum: 128 }, maxTokens: { type: "integer", minimum: 1, maximum: 262144 }, includeSummary: booleanSchema }, ["channel", "roles", "maxEntries", "maxTokens"]), inputs: [control], outputs: [p("control", "control"), p("messages", "messages")] }),
    spec({ type: "history.needsSummary", title: "需要摘要", description: "检查摘要游标后的 token", category: "history", execution: "async", configSchema: objectSchema({ channel: stringSchema(), thresholdTokens: { type: "integer", minimum: 1 } }, ["channel", "thresholdTokens"]), inputs: [control], outputs: [p("true", "control"), p("false", "control"), p("needed", "boolean")] }),
    spec({ type: "history.summarize", title: "生成摘要", description: "调用摘要模型压缩较早历史", category: "history", execution: "async", configSchema: objectSchema({ channel: stringSchema(), instruction: stringSchema(), keepLatest: { type: "integer", minimum: 1, maximum: 128 } }, ["channel", "instruction", "keepLatest"]), inputs: [control], outputs: [p("control", "control"), p("error", "control"), p("summary", "json")] }),
    spec({ type: "ai.llm", title: "LLM", description: "文本或结构化模型调用", category: "ai", execution: "stream-source", configSchema: objectSchema({ mode: stringSchema({ enum: ["text", "json"] }), modelSlot: stringSchema({ enum: ["main", "summary"] }), temperature: numberSchema({ minimum: 0, maximum: 2 }), maxTokens: { type: "integer", minimum: 1, maximum: 32768 }, outputSchema: {}, validator: stringSchema({ enum: ["immersive-novel-v1"] }), validatorConfig: { type: "object", properties: {}, additionalProperties: true } }, ["mode", "modelSlot"]), inputs: [control, p("messages", "messages", true)], outputs: [p("control", "control"), p("invalid", "control"), p("error", "control"), p("text", "text"), p("textStream", "text-stream"), p("json", "json")] }),
    spec({ type: "audio.stt", title: "语音转文字", description: "Fish Audio 批量转写", category: "audio", execution: "async", configSchema: emptySchema, inputs: [control, p("audio", "audio", true)], outputs: [p("control", "control"), p("error", "control"), p("finalText", "text")] }),
    spec({ type: "audio.tts", title: "文字转语音", description: "完整或流式 Fish Audio 合成", category: "audio", execution: "stream-source", configSchema: objectSchema({ mode: stringSchema({ enum: ["batch", "stream"] }) }, ["mode"]), inputs: [control, p("text", "text"), p("textStream", "text-stream")], outputs: [p("control", "control"), p("error", "control"), p("audio", "audio"), p("audioStream", "audio-stream")] }),
    spec({ type: "convert.textToStream", title: "文本转流", description: "完整文本确定性分块", category: "convert", execution: "stream-source", configSchema: objectSchema({ chunkCharacters: { type: "integer", minimum: 1, maximum: 4096 } }), inputs: [control, p("text", "text", true)], outputs: [p("control", "control"), p("textStream", "text-stream")] }),
    spec({ type: "convert.textFromStream", title: "流转文本", description: "收集文本流", category: "convert", execution: "stream-sink", configSchema: emptySchema, inputs: [control, p("textStream", "text-stream", true)], outputs: [p("control", "control"), p("text", "text")] }),
    spec({ type: "convert.audioToStream", title: "音频转流", description: "读取资源并有序分块", category: "convert", execution: "stream-source", configSchema: objectSchema({ chunkBytes: { type: "integer", minimum: 1024, maximum: 262144 } }), inputs: [control, p("audio", "audio", true)], outputs: [p("control", "control"), p("audioStream", "audio-stream")] }),
    spec({ type: "convert.audioFromStream", title: "流转音频", description: "收集并固化音频资源", category: "convert", execution: "stream-sink", configSchema: emptySchema, inputs: [control, p("audioStream", "audio-stream", true)], outputs: [p("control", "control"), p("audio", "audio")] }),
    spec({ type: "view.render", title: "渲染视图", description: "替换 committed view draft", category: "view", execution: "sync", configSchema: objectSchema({ view: {} }, ["view"]), inputs: [control, p("view", "view")], outputs: [p("control", "control"), p("view", "view")], sideEffect: true, resourceIds: (node) => collectViewResourceIds(node.config.view as unknown as WorldView) }),
    spec({ type: "view.patch", title: "修改视图", description: "用配置或动态 JSON 修改已有元素", category: "view", execution: "sync", configSchema: objectSchema({ elementId: stringSchema(), patch: {} }, ["elementId"]), inputs: [control, p("patch", "json")], outputs: [p("control", "control"), p("view", "view")], sideEffect: true, validate: requireElementId }),
    spec({ type: "view.streamText", title: "流式文本", description: "将文本增量写入临时元素", category: "view", execution: "stream-sink", configSchema: objectSchema({ elementId: stringSchema() }, ["elementId"]), inputs: [control, p("textStream", "text-stream", true)], outputs: [p("control", "control")], sideEffect: true, validate: requireElementId }),
    spec({ type: "view.showChoices", title: "显示选项", description: "更新受控 choices 元素", category: "view", execution: "sync", configSchema: objectSchema({ elementId: stringSchema(), actionId: stringSchema() }, ["elementId", "actionId"]), inputs: [control, p("choices", "json", true)], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "view.setBusy", title: "设置忙碌", description: "更新输入状态提示", category: "view", execution: "sync", configSchema: objectSchema({ busy: booleanSchema, label: stringSchema() }, ["busy"]), inputs: [control], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "view.playAudio", title: "播放音频", description: "播放完整资源", category: "view", execution: "sync", configSchema: emptySchema, inputs: [control, p("audio", "audio", true)], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "view.playAudioStream", title: "播放音频流", description: "顺序推送音频块", category: "view", execution: "stream-sink", configSchema: emptySchema, inputs: [control, p("audioStream", "audio-stream", true)], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "view.stopAudio", title: "停止音频", description: "停止当前世界音频", category: "view", execution: "sync", configSchema: emptySchema, inputs: [control], outputs: [p("control", "control")], sideEffect: true }),
    spec({ type: "view.showError", title: "显示错误", description: "终止本轮并显示作者配置的错误提示", category: "view", execution: "sync", configSchema: objectSchema({ message: stringSchema(), errorCode: stringSchema({ pattern: "^WORLD_[A-Z0-9_]+$" }) }, ["message"]), inputs: [control], outputs: [p("control", "control")], sideEffect: true }),
  ].map((item) => [item.type, item]),
);

export function publicPrimeWorldNodeCatalog() {
  return Object.values(primeWorldNodeRegistry).map(({ sideEffect: _sideEffect, validate: _validate, resourceIds: _resourceIds, ...entry }) => entry);
}

export function resolvePrimeWorldPort(node: PrimeWorldNode, direction: "input" | "output", portName: string) {
  const spec = primeWorldNodeRegistry[node.type];
  if (!spec) return undefined;
  if (node.type === "logic.switch" && direction === "output") {
    const cases = node.config.cases;
    if (cases && typeof cases === "object" && !Array.isArray(cases) && Object.values(cases).includes(portName)) return "control" as const;
  }
  if (node.type === "flow.fork" && direction === "output" && portName.startsWith("branch")) return "control" as const;
  if (node.type === "flow.join" && direction === "input" && portName.startsWith("in")) return "control" as const;
  if (node.type === "data.object" && direction === "input" && Array.isArray(node.config.fields) && node.config.fields.includes(portName)) return "json" as const;
  return spec[direction === "input" ? "inputs" : "outputs"].find((port) => port.name === portName)?.type;
}

export function collectPrimeWorldResourceIds(nodes: PrimeWorldNode[], startView?: WorldView) {
  const ids = new Set<string>(startView ? collectViewResourceIds(startView) : []);
  for (const node of nodes)
    for (const id of primeWorldNodeRegistry[node.type]?.resourceIds?.(node) ?? []) ids.add(id);
  return [...ids];
}

function collectViewResourceIds(view: WorldView | undefined) {
  if (!view) return [];
  const ids = new Set<string>();
  if (view.background?.resourceId) ids.add(view.background.resourceId);
  const visit = (element: WorldViewElement) => {
    if (element.type === "image") ids.add(element.resourceId);
    if (element.type === "stack") element.children.forEach(visit);
  };
  visit(view.root);
  return [...ids];
}

function requirePath(node: PrimeWorldNode) {
  if (typeof node.config.path !== "string" || !node.config.path.trim()) throw new Error("path 必须是非空字符串。");
}
function requireTemplate(node: PrimeWorldNode) {
  if (typeof node.config.template !== "string") throw new Error("template 必须是字符串。");
}
function requireElementId(node: PrimeWorldNode) {
  if (typeof node.config.elementId !== "string" || !node.config.elementId.trim()) throw new Error("elementId 必须是非空字符串。");
}
function validateMath(node: PrimeWorldNode) {
  if (!["add", "subtract", "multiply", "divide", "min", "max"].includes(String(node.config.operation ?? ""))) throw new Error("不支持的数学操作。");
}
function validateSwitch(node: PrimeWorldNode) {
  const cases = node.config.cases;
  if (!cases || typeof cases !== "object" || Array.isArray(cases)) throw new Error("cases 必须是匹配值到输出端口的对象。");
  for (const port of Object.values(cases)) if (typeof port !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(port)) throw new Error("switch 输出端口名称无效。");
}
function validateObjectFields(node: PrimeWorldNode) {
  const fields = Array.isArray(node.config.fields) ? node.config.fields : [];
  if (new Set(fields).size !== fields.length) throw new Error("data.object fields 不能重复。");
  if (fields.some((field) => typeof field !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field))) throw new Error("data.object 动态字段名无效。");
}
