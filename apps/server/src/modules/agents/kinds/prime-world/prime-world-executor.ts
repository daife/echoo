import { primeWorldViewSchema } from "@echoo/shared";
import type {
  JsonObject,
  JsonValue,
  PrimeWorldEventInput,
  PrimeWorldRunTraceEntry,
  PrimeWorldRuntimeState,
  WorldView,
  WorldViewElement,
} from "@echoo/shared";
import type { AiUsage, ChatCompletionMessage } from "../../../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import type { StoredPrimeWorldRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { FishAudioSttService } from "../../../stt/fish-audio-stt.service.js";
import { FishAudioTtsService } from "../../../tts/fish-audio-tts.service.js";
import type { CompiledPrimeWorld } from "./prime-world-compiler.js";
import { compilePrimeWorldJsonSchema } from "./prime-world-json-schema.js";
import { collectPrimeWorldResourceIds } from "./prime-world-node-registry.js";
import type {
  PrimeWorldResourceDraft,
  PrimeWorldTimerDraft,
  PrimeWorldRepository,
} from "./prime-world.repository.js";

export interface PrimeWorldHistoryDraft {
  nodeId: string;
  channel: string;
  role: string;
  content: JsonObject;
}

type TraceDraft = Omit<PrimeWorldRunTraceEntry, "sequence" | "runId">;
type AudioValue = { resourceId: string; mimeType?: string };
type RuntimeValue = JsonValue | Buffer | ReplayStream<string> | ReplayStream<Buffer>;

export interface PrimeWorldExecutionServices {
  ownerUserId: string;
  conversationId: string;
  runId: string;
  runtimeConfig?: StoredPrimeWorldRuntimeConfig;
  worlds?: PrimeWorldRepository;
  providers?: AiProviderRegistry;
  resources?: ResourceRepository;
  stt?: FishAudioSttService;
  push?: AppPushService;
  traceEnabled?: boolean;
}

export interface PrimeWorldExecutionResult {
  timers: PrimeWorldTimerDraft[];
  resources: PrimeWorldResourceDraft[];
  trace: TraceDraft[];
  cleanup: () => Promise<void>;
}

const MAX_NODE_EXECUTIONS = 500;
const MAX_EXTERNAL_CALLS = 8;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_VIEW_BYTES = 128 * 1024;
const MAX_HISTORY_ITEM_BYTES = 64 * 1024;
const RUN_TIMEOUT_MS = 120_000;

/** Ordered replayable broadcast. Replaying closes the sink-registration race for direct fan-out. */
export class ReplayStream<T> implements AsyncIterable<T> {
  private readonly chunks: T[] = [];
  private readonly waiters = new Set<() => void>();
  private done = false;
  private failure?: Error;

  publish(value: T) {
    if (this.done) throw new Error("STREAM_CLOSED");
    this.chunks.push(value);
    this.wake();
  }

  close() {
    if (this.done) return;
    this.done = true;
    this.wake();
  }

  fail(error: unknown) {
    if (this.done) return;
    this.failure = toError(error);
    this.done = true;
    this.wake();
  }

  private wake() {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async *[Symbol.asyncIterator]() {
    let index = 0;
    while (true) {
      while (index < this.chunks.length) yield this.chunks[index++]!;
      if (this.done) {
        if (this.failure) throw this.failure;
        return;
      }
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }
}

export async function executePrimeWorldGraph(
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  event: PrimeWorldEventInput,
  history: PrimeWorldHistoryDraft[],
  signal?: AbortSignal,
  services?: PrimeWorldExecutionServices,
): Promise<PrimeWorldExecutionResult> {
  const runtime = new WorldExecution(compiled, draft, event, history, signal, services);
  try {
    await runtime.run();
    draft.startedAt ??= Date.now();
    return runtime.result();
  } catch (error) {
    throw new PrimeWorldExecutionFailure(error, runtime.result());
  }
}

export class PrimeWorldExecutionFailure extends Error {
  constructor(
    readonly original: unknown,
    readonly partial: PrimeWorldExecutionResult,
  ) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "PrimeWorldExecutionFailure";
  }
}

export class PrimeWorldAuthoredError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(code);
    this.name = "PrimeWorldAuthoredError";
  }
}

class WorldExecution {
  private readonly values = new Map<string, RuntimeValue | Promise<RuntimeValue>>();
  private readonly completed = new Set<string>();
  private readonly joinArrivals = new Map<string, Set<string>>();
  private readonly timers: PrimeWorldTimerDraft[] = [];
  private readonly runResources: PrimeWorldResourceDraft[] = [];
  private readonly trace: TraceDraft[] = [];
  private readonly temporaryPaths: string[] = [];
  private readonly pending: Promise<unknown>[] = [];
  private readonly startedAt = Date.now();
  private nodeExecutions = 0;
  private externalCalls = 0;

  constructor(
    private readonly compiled: CompiledPrimeWorld,
    private readonly draft: PrimeWorldRuntimeState,
    private readonly event: PrimeWorldEventInput,
    private readonly history: PrimeWorldHistoryDraft[],
    private readonly signal?: AbortSignal,
    private readonly services?: PrimeWorldExecutionServices,
  ) {}

  async run() {
    if (Buffer.byteLength(JSON.stringify(this.event), "utf8") > 64 * 1024)
      throw new Error("EVENT_QUOTA_EXCEEDED");
    const triggerType = TRIGGER_BY_EVENT[this.event.type];
    const triggers = [...this.compiled.nodes.values()].filter((node) => node.type === triggerType);
    if (!triggers.length) throw new Error(`MISSING_TRIGGER:${triggerType}`);
    for (const trigger of triggers) this.seedTrigger(trigger.id);
    await Promise.all(triggers.map((trigger) => this.runControl(trigger.id, `event:${this.event.clientEventId}`)));
    await Promise.all(this.pending);
    this.assertQuotas();
  }

  result(): PrimeWorldExecutionResult {
    return {
      timers: this.timers,
      resources: this.runResources,
      trace: this.trace,
      cleanup: async () => {
        const owner = this.services?.ownerUserId;
        const resources = this.services?.resources;
        if (!owner || !resources) return;
        await Promise.allSettled(this.temporaryPaths.map((path) => resources.deleteOwnedByPublicPath(owner, path)));
      },
    };
  }

  private seedTrigger(id: string) {
    const payload = this.event.payload ?? {};
    this.values.set(`${id}:event`, payload);
    this.values.set(`${id}:payload`, asJson(payload.payload ?? payload));
    this.values.set(`${id}:actionId`, String(payload.actionId ?? ""));
    this.values.set(`${id}:text`, String(payload.text ?? ""));
    this.values.set(`${id}:audio`, normalizeAudio(payload));
    this.values.set(`${id}:triggerKey`, String(payload.triggerKey ?? ""));
  }

  private async runControl(id: string, arrival: string): Promise<void> {
    this.checkCancelled();
    const node = this.compiled.nodes.get(id);
    if (!node) return;
    if (node.type === "flow.join") {
      const arrivals = this.joinArrivals.get(id) ?? new Set<string>();
      arrivals.add(arrival);
      this.joinArrivals.set(id, arrivals);
      const expected = [...this.compiled.incoming.entries()]
        .filter(([key]) => key === `${id}:in` || key.startsWith(`${id}:in`))
        .flatMap(([, edges]) => edges.filter((edge) => edge.kind === "control")).length;
      if (node.config.mode === "all" && arrivals.size < Math.max(1, expected)) return;
      if (this.completed.has(id)) return;
    } else if (this.completed.has(id)) return;
    this.completed.add(id);
    if (++this.nodeExecutions > MAX_NODE_EXECUTIONS) throw new Error("NODE_EXECUTION_QUOTA_EXCEEDED");

    const traceStarted = Date.now();
    this.emitTrace({ nodeId: id, nodeType: node.type, phase: "started", startedAt: traceStarted });
    let outputs: string[];
    try {
      outputs = await this.executeNode(node);
      for (const output of outputs)
        if ((output === "error" || output === "invalid") && !(node.type === "history.summarize" && output === "error") && !(this.compiled.outgoing.get(`${id}:${output}`) ?? []).some((edge) => edge.kind === "control"))
          throw new Error(output === "invalid" ? "UNHANDLED_INVALID_OUTPUT" : "UNHANDLED_NODE_ERROR");
      this.assertQuotas();
      this.emitTrace({
        nodeId: id,
        nodeType: node.type,
        phase: "completed",
        startedAt: traceStarted,
        finishedAt: Date.now(),
        durationMs: Date.now() - traceStarted,
        inputSummary: this.inputSummary(id),
        outputSummary: this.outputSummary(id),
      });
    } catch (error) {
      this.emitTrace({
        nodeId: id,
        nodeType: node.type,
        phase: "failed",
        startedAt: traceStarted,
        finishedAt: Date.now(),
        durationMs: Date.now() - traceStarted,
        errorCode: stableErrorCode(error),
        errorDetail: safeError(error),
      });
      throw error;
    }

    const tasks: Promise<void>[] = [];
    for (const output of outputs) {
      for (const edge of this.compiled.outgoing.get(`${id}:${output}`) ?? []) {
        if (edge.kind !== "control") continue;
        tasks.push(this.runControl(edge.target.nodeId, edge.id));
      }
    }
    await Promise.all(tasks);
  }

  private async executeNode(node: CompiledPrimeWorld["nodes"] extends Map<string, infer N> ? N : never): Promise<string[]> {
    const input = (port: string, fallback: RuntimeValue = null) => this.resolveInput(node.id, port, fallback);
    const set = (port: string, value: RuntimeValue | Promise<RuntimeValue>) => this.values.set(`${node.id}:${port}`, value);
    const context = { input: this.event.payload ?? {}, state: this.draft.variables };

    if (node.type.startsWith("trigger.") || node.type === "flow.noop" || node.type === "flow.fork" || node.type === "flow.join") return node.type === "flow.fork" ? this.controlOutputPorts(node.id) : ["control"];
    if (node.type === "state.set") {
      setPointer(this.draft.variables, String(node.config.path), asJson(await input("value", resolveDeep(node.config.value ?? null, context))));
      return ["control"];
    }
    if (node.type === "state.patch") {
      const patch = await input("patch");
      if (!isObject(patch)) return ["invalid"];
      if (node.config.mode === "immersive-novel-v1") {
        if (!validateImmersiveStatePatch(patch, node.config.validatorConfig, this.draft.variables)) return ["invalid"];
        if (!applyImmersiveNovelPatch(this.draft.variables, patch)) return ["invalid"];
      } else {
        const allowed = new Set((Array.isArray(node.config.allowedPaths) ? node.config.allowedPaths : []).map(String));
        if (!applyRestrictedPatch(this.draft.variables, patch, allowed)) return ["invalid"];
      }
      return ["control"];
    }
    if (node.type === "state.saveSummary") {
      const summary = await input("summary");
      if (!isObject(summary) || typeof summary.text !== "string" || typeof summary.throughSequence !== "number") throw new Error("INVALID_SUMMARY");
      this.draft.summaries[String(node.config.channel)] = { text: summary.text, throughSequence: summary.throughSequence, updatedAt: Date.now() };
      return ["control"];
    }
    if (node.type === "data.template") {
      set("text", interpolate(String(node.config.template), context));
      return ["control"];
    }
    if (node.type === "data.object") {
      const base = resolveDeep(node.config.value ?? {}, context);
      if (!isObject(base)) throw new Error("INVALID_OBJECT_VALUE");
      for (const field of Array.isArray(node.config.fields) ? node.config.fields.map(String) : [])
        base[field] = asJson(await input(field));
      set("value", base);
      return ["control"];
    }
    if (node.type === "data.messages") {
      const fromInput = await input("history", []);
      const text = await input("text", "");
      const resolved = resolveDeep(node.config.messages ?? [], context);
      const configured = Array.isArray(resolved) ? resolved : [];
      set("messages", [...configured, ...(Array.isArray(fromInput) ? fromInput : []), ...(typeof text === "string" && text ? [{ role: String(node.config.textRole ?? "user"), content: text }] : [])] as JsonValue[]);
      return ["control"];
    }
    if (node.type === "data.normalizeAction") {
      const raw = await input("event", this.event.payload ?? {});
      const payload = isObject(raw) ? raw : {};
      set("action", { kind: payload.actionId ? "choice" : "text", actionId: payload.actionId ?? null, text: payload.text ?? null, payload: payload.payload ?? payload });
      return ["control"];
    }
    if (node.type === "data.toText") {
      const value = await input("value");
      set("text", typeof value === "string" ? value : JSON.stringify(value));
      return ["control"];
    }
    if (node.type === "logic.if") return deepEqual(await input("value", resolveDeep(node.config.value ?? null, context)), resolveDeep(node.config.equals ?? true, context)) ? ["true"] : ["false"];
    if (node.type === "logic.switch") {
      const selected = String(await input("value", resolveDeep(node.config.value ?? null, context)));
      const cases = node.config.cases as JsonObject;
      return [typeof cases[selected] === "string" ? String(cases[selected]) : "default"];
    }
    if (node.type === "logic.compare") {
      set("value", compare(String(node.config.operation), await input("left"), await input("right")));
      return ["control"];
    }
    if (node.type === "logic.math") {
      set("value", math(String(node.config.operation), Number(await input("left", 0)), Number(await input("right", 0))));
      return ["control"];
    }
    if (node.type === "logic.random") {
      set("value", randomInRange(Number(node.config.min ?? 0), Number(node.config.max ?? 1), Boolean(node.config.integer)));
      return ["control"];
    }
    if (node.type === "timer.schedule") {
      this.timers.push({ operation: "schedule", triggerKey: String(node.config.triggerKey), dueAt: Date.now() + Number(node.config.dueInMs), payload: isObject(node.config.payload) ? node.config.payload : {} });
      return ["control"];
    }
    if (node.type === "timer.cancel") {
      this.timers.push({ operation: "cancel", triggerKey: String(node.config.triggerKey) });
      return ["control"];
    }
    if (node.type === "history.append") {
      const content = await input("content", resolveDeep(node.config.content ?? "", context));
      const normalized = isObject(content) ? content : { value: asJson(content) };
      if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_HISTORY_ITEM_BYTES) throw new Error("HISTORY_ITEM_QUOTA_EXCEEDED");
      this.history.push({ nodeId: node.id, channel: String(node.config.channel), role: String(node.config.role), content: normalized });
      if (this.history.length > 128) throw new Error("HISTORY_QUOTA_EXCEEDED");
      return ["control"];
    }
    if (node.type === "history.read") {
      set("messages", await this.readHistory(node.config));
      return ["control"];
    }
    if (node.type === "history.needsSummary") {
      const needed = await this.needsSummary(String(node.config.channel), Number(node.config.thresholdTokens));
      set("needed", needed);
      return [needed ? "true" : "false"];
    }
    if (node.type === "history.summarize") return this.summarizeHistory(node.id, node.config, set);
    if (node.type === "ai.llm") return this.runLlm(node.id, node.config, await input("messages"), set);
    if (node.type === "audio.stt") return this.runStt(node.id, await input("audio"), set);
    if (node.type === "audio.tts") return this.runTts(node.id, node.config, input, set);
    if (node.type === "convert.textToStream") {
      const text = String(await input("text", ""));
      const stream = new ReplayStream<string>();
      set("textStream", stream);
      this.track(produceText(stream, text, Number(node.config.chunkCharacters ?? 256), this.signal));
      return ["control"];
    }
    if (node.type === "convert.textFromStream") {
      set("text", await collectText(asTextStream(await input("textStream")), MAX_TEXT_BYTES, this.signal));
      return ["control"];
    }
    if (node.type === "convert.audioToStream") {
      const stream = new ReplayStream<Buffer>();
      set("audioStream", stream);
      this.track(this.produceAudio(stream, asAudio(await input("audio")), Number(node.config.chunkBytes ?? 64 * 1024)));
      return ["control"];
    }
    if (node.type === "convert.audioFromStream") {
      const audio = await collectAudio(asAudioStream(await input("audioStream")), MAX_AUDIO_BYTES, this.signal);
      set("audio", await this.saveAudio(node.id, "audio", audio));
      return ["control"];
    }
    if (node.type === "view.render") {
      const view = primeWorldViewSchema.parse(await input("view", resolveDeep(node.config.view ?? null, context))) as WorldView;
      await this.assertViewResources(view);
      this.draft.view = { ...structuredClone(view), revision: this.draft.view.revision + 1 };
      set("view", this.draft.view as unknown as JsonObject);
      return ["control"];
    }
    if (node.type === "view.patch") {
      const element = findElement(this.draft.view.root, String(node.config.elementId));
      if (!element) throw new Error(`VIEW_ELEMENT_NOT_FOUND:${String(node.config.elementId)}`);
      const patch = await input("patch", resolveDeep(node.config.patch ?? {}, context));
      if (!isObject(patch) || "id" in patch || "type" in patch) throw new Error("INVALID_VIEW_PATCH");
      Object.assign(element, patch);
      primeWorldViewSchema.parse(this.draft.view);
      await this.assertViewResources(this.draft.view);
      this.draft.view = { ...this.draft.view, revision: this.draft.view.revision + 1 };
      set("view", this.draft.view as unknown as JsonObject);
      return ["control"];
    }
    if (node.type === "view.streamText") {
      let sequence = 0;
      for await (const delta of asTextStream(await input("textStream"))) {
        this.checkCancelled();
        this.publish({ type: "world.view.text_delta", nodeId: node.id, elementId: String(node.config.elementId), sequence: sequence++, delta });
      }
      return ["control"];
    }
    if (node.type === "view.showChoices") {
      const element = findElement(this.draft.view.root, String(node.config.elementId));
      if (!element || element.type !== "choices") throw new Error("VIEW_CHOICES_NOT_FOUND");
      const choices = await input("choices");
      if (!Array.isArray(choices)) throw new Error("INVALID_CHOICES");
      element.actionId = String(node.config.actionId);
      element.choices = choices as typeof element.choices;
      primeWorldViewSchema.parse(this.draft.view);
      this.draft.view = { ...this.draft.view, revision: this.draft.view.revision + 1 };
      return ["control"];
    }
    if (node.type === "view.playAudio") {
      const audio = asAudio(await input("audio"));
      if (this.shouldAutoPlay()) this.publish({ type: "world.audio.completed", nodeId: node.id, port: "audio", resourceId: audio.resourceId });
      return ["control"];
    }
    if (node.type === "view.playAudioStream") {
      let sequence = 0;
      const play = this.shouldAutoPlay();
      if (play) this.publish({ type: "world.audio.started", nodeId: node.id, port: "audioStream", mimeType: "audio/mpeg" });
      try {
        for await (const chunk of asAudioStream(await input("audioStream"))) {
          this.checkCancelled();
          if (play) this.services?.push?.pushBinaryToUser(this.services.ownerUserId, { type: "world.audio.chunk", conversationId: this.services.conversationId, runId: this.services.runId, nodeId: node.id, port: "audioStream", sequence: sequence++, mimeType: "audio/mpeg" }, chunk);
        }
        if (play) this.publish({ type: "world.audio.completed", nodeId: node.id, port: "audioStream" });
      } catch (error) {
        if (play) this.publish({ type: "world.audio.failed", nodeId: node.id, port: "audioStream", error: stableErrorCode(error) });
        throw error;
      }
      return ["control"];
    }
    if (node.type === "view.stopAudio") {
      this.publish({ type: "world.audio.failed", nodeId: node.id, port: "audioStream", error: "stopped" });
      return ["control"];
    }
    if (node.type === "view.showError") {
      throw new PrimeWorldAuthoredError(
        typeof node.config.errorCode === "string"
          ? node.config.errorCode
          : "WORLD_AUTHORED_ERROR",
        String(node.config.message),
      );
    }
    if (node.type === "view.setBusy") return ["control"];
    throw new Error(`NODE_HANDLER_NOT_REGISTERED:${node.type}`);
  }

  private async resolveInput(nodeId: string, port: string, fallback: RuntimeValue): Promise<RuntimeValue> {
    const edge = this.compiled.incoming.get(`${nodeId}:${port}`)?.find((item) => item.kind === "data");
    return edge ? this.evaluateData(edge.source.nodeId, edge.source.port) : fallback;
  }

  private async evaluateData(nodeId: string, port: string): Promise<RuntimeValue> {
    const key = `${nodeId}:${port}`;
    if (this.values.has(key)) return await this.values.get(key)!;
    const node = this.compiled.nodes.get(nodeId);
    if (!node) throw new Error(`DATA_NODE_NOT_FOUND:${nodeId}`);
    const context = { input: this.event.payload ?? {}, state: this.draft.variables };
    let value: RuntimeValue;
    if (node.type === "state.get") value = readPointer(this.draft.variables, String(node.config.path)) ?? null;
    else if (node.type === "data.constant") value = resolveDeep(node.config.value ?? null, context);
    else if (node.type === "data.template") value = interpolate(String(node.config.template), context);
    else if (node.type === "data.pick") {
      const source = await this.resolveInput(node.id, "source", node.config.source ?? {});
      value = isObject(source) ? readPointer(source, String(node.config.path)) ?? null : null;
    } else if (node.type === "data.object") value = resolveDeep(node.config.value ?? {}, context);
    else throw new Error(`DATA_NOT_READY:${nodeId}:${port}`);
    this.values.set(key, value);
    return value;
  }

  private async runLlm(id: string, config: JsonObject, messagesValue: RuntimeValue, set: (port: string, value: RuntimeValue | Promise<RuntimeValue>) => void): Promise<string[]> {
    try {
      const runtime = this.requireRuntime();
      const modelConfig = config.modelSlot === "summary" ? runtime.summaryModel : runtime.mainModel;
      const provider = (this.services?.providers ?? new AiProviderRegistry()).createProvider(modelConfig);
      const maxTokens = Math.min(Number(config.maxTokens ?? modelConfig.maxTokens), modelConfig.maxTokens);
      const promptBudget = runtime.context.windowTokens - runtime.context.providerReserveTokens - maxTokens;
      if (promptBudget <= 0) throw new Error("LLM_CONTEXT_QUOTA_EXCEEDED");
      const messages = fitChatMessages(normalizeMessages(messagesValue), promptBudget);
      const request = { model: modelConfig.model, sessionId: `world_${this.services?.conversationId ?? "test"}`, messages, temperature: Math.min(Number(config.temperature ?? modelConfig.temperature), 2), maxTokens, reasoningEnabled: modelConfig.reasoningEnabled, reasoningEffort: modelConfig.reasoningEffort, signal: this.signal } as const;
      if (config.mode === "text") {
        const stream = new ReplayStream<string>();
        set("textStream", stream);
        const complete = (async () => {
          let text = "";
          let usage: AiUsage | undefined;
          let attempt = 0;
          while (true) {
            let delivered = false;
            try {
              this.countExternal();
              if (provider.streamChatCompletion) {
                for await (const delta of provider.streamChatCompletion(request)) {
                  this.checkCancelled();
                  if (delta.text) { delivered = true; text += delta.text; stream.publish(delta.text); }
                  if (delta.usage) usage = { ...usage, ...delta.usage };
                  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new Error("LLM_OUTPUT_QUOTA_EXCEEDED");
                }
              } else {
                const response = await provider.createChatCompletion(request);
                text = response.text;
                usage = response.usage;
                delivered = true;
                stream.publish(text);
              }
              stream.close();
              this.attachUsage(id, usage);
              return text;
            } catch (error) {
              if (attempt === 0 && !delivered && isRetryableProviderError(error)) {
                attempt += 1;
                text = "";
                usage = undefined;
                continue;
              }
              stream.fail(error);
              throw error;
            }
          }
        })();
        set("text", complete);
        this.track(complete);
        await Promise.resolve();
        return ["control"];
      }
      const responseFormat = { type: "json_schema", json_schema: { name: "prime_world_output", strict: true, schema: config.outputSchema } } as const;
      const validate = compilePrimeWorldJsonSchema(config.outputSchema as JsonObject);
      let messagesForAttempt = request.messages;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await this.withExternalRetry(() => provider.createChatCompletion({ ...request, messages: messagesForAttempt, responseFormat }));
        this.attachUsage(id, response.usage);
        if (Buffer.byteLength(response.text, "utf8") > MAX_TEXT_BYTES) throw new Error("LLM_JSON_QUOTA_EXCEEDED");
        const result = validateWorldJsonOutput(
          response.text,
          validate,
          config.validator,
          config.validatorConfig,
          this.draft.variables,
        );
        if (result.value !== undefined) {
          set("json", result.value);
          return ["control"];
        }
        if (attempt > 0 || this.externalCalls >= MAX_EXTERNAL_CALLS) return ["invalid"];
        messagesForAttempt = [
          ...request.messages,
          { role: "assistant" as const, content: response.text.slice(0, 32_000) },
          {
            role: "user" as const,
            content: [
              "上一个 JSON 输出未通过应用校验。请只返回修复后的完整 JSON 对象，不要解释。",
              ...result.issues.slice(0, 12).map((issue) => `- ${issue}`),
            ].join("\n"),
          },
        ];
      }
      return ["invalid"];
    } catch (error) {
      if (stableErrorCode(error) === "CANCELLED") throw error;
      set("text", "");
      return ["error"];
    }
  }

  private async runStt(id: string, value: RuntimeValue, set: (port: string, value: RuntimeValue) => void) {
    try {
      const services = this.requireServices();
      const text = await this.withExternalRetry(() => (services.stt ?? new FishAudioSttService()).transcribeResource(services.ownerUserId, asAudio(value).resourceId, this.requireRuntime().stt, this.signal));
      set("finalText", text);
      return ["control"];
    } catch (error) {
      if (stableErrorCode(error) === "CANCELLED") throw error;
      return ["error"];
    }
  }

  private async runTts(id: string, config: JsonObject, input: (port: string, fallback?: RuntimeValue) => Promise<RuntimeValue>, set: (port: string, value: RuntimeValue | Promise<RuntimeValue>) => void) {
    const stream = new ReplayStream<Buffer>();
    set("audioStream", stream);
    const complete = (async () => {
      try {
        this.countExternal();
        const tts = new FishAudioTtsService(this.requireRuntime().tts);
        let result;
        if (config.mode === "stream") {
          const session = tts.createStream((chunk) => stream.publish(chunk));
          const abort = () => session.abort();
          this.signal?.addEventListener("abort", abort, { once: true });
          try {
            for await (const delta of asTextStream(await input("textStream"))) { this.checkCancelled(); session.write(delta); }
            result = await session.finish();
          } finally { this.signal?.removeEventListener("abort", abort); }
        } else {
          result = await tts.synthesize(String(await input("text", "")), (chunk) => stream.publish(chunk), this.signal);
        }
        stream.close();
        const saved = await this.saveAudio(id, "audio", result.audio);
        this.publish({ type: "world.audio.completed", nodeId: id, port: "audio", resourceId: saved.resourceId });
        return saved;
      } catch (error) { stream.fail(error); throw error; }
    })();
    set("audio", complete);
    this.track(complete);
    return ["control"];
  }

  private async produceAudio(stream: ReplayStream<Buffer>, audio: AudioValue, chunkBytes: number) {
    try {
      const services = this.requireServices();
      const resource = await (services.resources ?? new ResourceRepository()).readForOwner(services.ownerUserId, audio.resourceId);
      if (!resource || resource.record.status !== "ready") throw new Error("AUDIO_RESOURCE_NOT_FOUND");
      const size = Math.min(262_144, Math.max(1_024, Math.trunc(chunkBytes)));
      for (let offset = 0; offset < resource.data.length; offset += size) { this.checkCancelled(); stream.publish(resource.data.subarray(offset, offset + size)); }
      stream.close();
    } catch (error) { stream.fail(error); }
  }

  private async saveAudio(nodeId: string, port: string, data: Buffer): Promise<JsonObject> {
    if (data.byteLength > MAX_AUDIO_BYTES) throw new Error("AUDIO_QUOTA_EXCEEDED");
    const services = this.requireServices();
    const repository = services.resources ?? new ResourceRepository();
    const saved = await repository.saveGeneratedMedia(services.ownerUserId, "prime_world_audio", "audio/mpeg", data);
    this.temporaryPaths.push(saved.publicPath);
    this.runResources.push({ nodeId, port, resourceId: saved.id, mimeType: saved.mimeType });
    return { resourceId: saved.id, mimeType: saved.mimeType };
  }

  private async readHistory(config: JsonObject): Promise<JsonValue[]> {
    const channel = String(config.channel);
    const roles = (config.roles as JsonValue[]).map(String);
    const maxEntries = Number(config.maxEntries);
    const maxTokens = Number(config.maxTokens);
    const summary = config.includeSummary ? this.draft.summaries[channel] : undefined;
    const stored = this.services?.worlds
      ? summary
        ? (await this.services.worlds.readHistoryAfter(this.services.ownerUserId, this.services.conversationId, channel, summary.throughSequence, maxEntries)).filter((entry) => roles.includes(entry.role))
        : await this.services.worlds.readHistory(this.services.ownerUserId, this.services.conversationId, { channel, roles, maxEntries, maxTokens })
      : [];
    const current = this.history.filter((entry) => entry.channel === channel && roles.includes(entry.role)).map((entry) => ({ role: entry.role, content: entry.content }));
    const summaryEntry: JsonValue | undefined = summary ? { role: "system", content: summary.text } : undefined;
    const reservedTokens = summaryEntry ? Math.min(maxTokens, estimateTokens(summaryEntry)) : 0;
    const recent = fitHistory([...stored.map((entry) => ({ role: entry.role, content: entry.content })), ...current], Math.max(0, maxEntries - (summaryEntry ? 1 : 0)), Math.max(0, maxTokens - reservedTokens));
    return summaryEntry ? [truncateMessageToTokens(summaryEntry, maxTokens), ...recent] : recent;
  }

  private async needsSummary(channel: string, threshold: number) {
    const cursor = this.draft.summaries[channel]?.throughSequence ?? 0;
    const stored = this.services?.worlds ? await this.services.worlds.readHistoryAfter(this.services.ownerUserId, this.services.conversationId, channel, cursor) : [];
    const draftTokens = this.history.filter((entry) => entry.channel === channel).reduce((sum, entry) => sum + estimateTokens(entry.content), 0);
    return stored.reduce((sum, entry) => sum + entry.tokenEstimate, draftTokens) >= threshold;
  }

  private async summarizeHistory(id: string, config: JsonObject, set: (port: string, value: RuntimeValue) => void): Promise<string[]> {
    try {
      const channel = String(config.channel);
      const cursor = this.draft.summaries[channel]?.throughSequence ?? 0;
      const rows = this.services?.worlds ? await this.services.worlds.readHistoryAfter(this.services.ownerUserId, this.services.conversationId, channel, cursor) : [];
      const keepLatest = Number(config.keepLatest);
      const compress = rows.slice(0, Math.max(0, rows.length - keepLatest));
      if (!compress.length) { set("summary", { text: this.draft.summaries[channel]?.text ?? "", throughSequence: cursor }); return ["control"]; }
      const runtime = this.requireRuntime();
      const model = runtime.summaryModel;
      const provider = (this.services?.providers ?? new AiProviderRegistry()).createProvider(model);
      const promptBudget = runtime.context.windowTokens - runtime.context.providerReserveTokens - model.maxTokens;
      const system: ChatCompletionMessage = { role: "system", content: `${String(config.instruction)}\n旧摘要：${this.draft.summaries[channel]?.text ?? "（无）"}` };
      let usedTokens = estimateTokens(system);
      const included: typeof compress = [];
      const entryMessages: ChatCompletionMessage[] = [];
      for (const entry of compress) {
        const message: ChatCompletionMessage = { role: "user", content: JSON.stringify({ sequence: entry.sequence, role: entry.role, content: entry.content }) };
        const tokens = estimateTokens(message);
        if (usedTokens + tokens > promptBudget) break;
        usedTokens += tokens;
        included.push(entry);
        entryMessages.push(message);
      }
      if (!included.length) throw new Error("SUMMARY_CONTEXT_QUOTA_EXCEEDED");
      const messages = [system, ...entryMessages];
      const response = await this.withExternalRetry(() => provider.createChatCompletion({ model: model.model, sessionId: `world_summary_${this.services?.conversationId}`, temperature: Math.min(model.temperature, 0.5), maxTokens: model.maxTokens, signal: this.signal, messages }));
      const value = { text: response.text, throughSequence: included.at(-1)!.sequence };
      set("summary", value);
      this.attachUsage(id, response.usage);
      return ["control"];
    } catch (error) {
      if (stableErrorCode(error) === "CANCELLED") throw error;
      return ["error"];
    }
  }

  private controlOutputPorts(nodeId: string) {
    const prefix = `${nodeId}:`;
    return [...this.compiled.outgoing.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  }

  private outputSummary(nodeId: string): JsonObject {
    const result: JsonObject = {};
    for (const [key, value] of this.values) if (key.startsWith(`${nodeId}:`) && !(value instanceof Promise)) result[key.slice(nodeId.length + 1)] = summarizeValue(value);
    return result;
  }

  private inputSummary(nodeId: string): JsonObject {
    const result: JsonObject = {};
    for (const [key, edges] of this.compiled.incoming) {
      if (!key.startsWith(`${nodeId}:`)) continue;
      const port = key.slice(nodeId.length + 1);
      const edge = edges.find((item) => item.kind === "data");
      if (!edge) continue;
      const value = this.values.get(`${edge.source.nodeId}:${edge.source.port}`);
      result[port] = value instanceof Promise ? { kind: "pending" } : value === undefined ? { kind: "lazy" } : summarizeValue(value);
    }
    return result;
  }

  private emitTrace(entry: TraceDraft) {
    this.trace.push(entry);
    if (!this.services || this.services.traceEnabled === false) return;
    this.services.push?.pushToUser(this.services.ownerUserId, { type: "world.trace.entry", conversationId: this.services.conversationId, runId: this.services.runId, entry: { ...entry, sequence: this.trace.length, runId: this.services.runId } });
  }

  private attachUsage(nodeId: string, usage?: AiUsage) {
    if (!usage) return;
    for (let index = this.trace.length - 1; index >= 0; index--) if (this.trace[index]!.nodeId === nodeId) { this.trace[index]!.usage = sanitizeJson(usage as unknown as JsonObject); return; }
  }

  private publish(extra: Record<string, unknown>) {
    if (!this.services) return;
    this.services.push?.pushToUser(this.services.ownerUserId, { conversationId: this.services.conversationId, runId: this.services.runId, ...extra });
  }

  private requireRuntime() {
    if (!this.services?.runtimeConfig) throw new Error("WORLD_RUNTIME_CONFIG_REQUIRED");
    return this.services.runtimeConfig;
  }

  private requireServices() {
    if (!this.services) throw new Error("WORLD_EXECUTION_SERVICES_REQUIRED");
    return this.services;
  }

  private shouldAutoPlay() {
    return this.services?.runtimeConfig?.audio.autoPlay !== false && this.draft.view.audio?.autoPlay !== false;
  }

  private async assertViewResources(view: WorldView) {
    const ids = collectPrimeWorldResourceIds([], view);
    if (!ids.length) return;
    const services = this.requireServices();
    const resources = services.resources ?? new ResourceRepository();
    for (const id of ids) {
      const resource = await resources.findById(id);
      if (!resource || resource.ownerUserId !== services.ownerUserId || resource.status !== "ready")
        throw new Error("WORLD_VIEW_RESOURCE_INVALID");
    }
  }

  private countExternal() {
    if (++this.externalCalls > MAX_EXTERNAL_CALLS) throw new Error("EXTERNAL_CALL_QUOTA_EXCEEDED");
  }

  private track<T>(promise: Promise<T>) {
    this.pending.push(promise);
    void promise.catch(() => undefined);
    return promise;
  }

  private async withExternalRetry<T>(operation: () => Promise<T>) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.countExternal();
        return await operation();
      } catch (error) {
        if (attempt === 0 && isRetryableProviderError(error)) continue;
        throw error;
      }
    }
  }

  private checkCancelled() {
    if (this.signal?.aborted) throw new WorldRunCancelled();
    if (Date.now() - this.startedAt > RUN_TIMEOUT_MS) throw new Error("RUN_TIMEOUT");
  }

  private assertQuotas() {
    this.checkCancelled();
    if (Buffer.byteLength(JSON.stringify(this.draft.variables), "utf8") > MAX_STATE_BYTES) throw new Error("STATE_QUOTA_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify(this.draft.view), "utf8") > MAX_VIEW_BYTES) throw new Error("VIEW_QUOTA_EXCEEDED");
    if (this.compiled.stateValidator && !this.compiled.stateValidator(this.draft.variables)) throw new Error("STATE_SCHEMA_INVALID");
  }
}

const TRIGGER_BY_EVENT: Record<PrimeWorldEventInput["type"], string> = {
  "world.start": "trigger.worldStart",
  "ui.action": "trigger.uiAction",
  "input.text": "trigger.textInput",
  "input.voice": "trigger.voiceInput",
  "timer.fired": "trigger.timer",
};

async function produceText(stream: ReplayStream<string>, text: string, chunkCharacters: number, signal?: AbortSignal) {
  try {
    const characters = Array.from(text);
    const size = Math.min(4096, Math.max(1, Math.trunc(chunkCharacters)));
    for (let offset = 0; offset < characters.length; offset += size) {
      if (signal?.aborted) throw new WorldRunCancelled();
      stream.publish(characters.slice(offset, offset + size).join(""));
      await Promise.resolve();
    }
    stream.close();
  } catch (error) { stream.fail(error); }
}

async function collectText(stream: ReplayStream<string>, maxBytes: number, signal?: AbortSignal) {
  let result = "";
  for await (const chunk of stream) {
    if (signal?.aborted) throw new WorldRunCancelled();
    result += chunk;
    if (Buffer.byteLength(result, "utf8") > maxBytes) throw new Error("TEXT_STREAM_QUOTA_EXCEEDED");
  }
  return result;
}

async function collectAudio(stream: ReplayStream<Buffer>, maxBytes: number, signal?: AbortSignal) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new WorldRunCancelled();
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error("AUDIO_STREAM_QUOTA_EXCEEDED");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function fitHistory(entries: JsonValue[], maxEntries: number, maxTokens: number) {
  let tokens = 0;
  const kept: JsonValue[] = [];
  for (const entry of entries.slice(-maxEntries).reverse()) {
    const next = estimateTokens(entry);
    if (tokens + next > maxTokens) {
      const truncated = truncateMessageToTokens(entry, maxTokens - tokens);
      if (truncated !== entry) {
        tokens = maxTokens;
        kept.push(truncated);
      }
      continue;
    }
    tokens += next;
    kept.push(entry);
  }
  return kept.reverse();
}

function truncateMessageToTokens(entry: JsonValue, maxTokens: number): JsonValue {
  if (maxTokens <= 0 || !isObject(entry) || typeof entry.content !== "string") return entry;
  const budget = maxTokens * 4;
  if (Buffer.byteLength(JSON.stringify(entry), "utf8") <= budget) return entry;
  let text = "";
  for (const character of Array.from(entry.content)) {
    if (Buffer.byteLength(JSON.stringify({ ...entry, content: text + character }), "utf8") > budget) break;
    text += character;
  }
  return { ...entry, content: text };
}

function estimateTokens(value: unknown) { return Math.ceil(JSON.stringify(value).length / 4); }

function normalizeMessages(value: RuntimeValue): ChatCompletionMessage[] {
  if (!Array.isArray(value)) throw new Error("INVALID_LLM_MESSAGES");
  return value.map((item) => {
    if (!isObject(item)) throw new Error("INVALID_LLM_MESSAGE");
    const role = String(item.role) === "narrator" ? "assistant" : String(item.role);
    if (!["system", "user", "assistant", "tool"].includes(role)) throw new Error("INVALID_LLM_MESSAGE_ROLE");
    const content = typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? "");
    return { role: role as ChatCompletionMessage["role"], content };
  });
}

function fitChatMessages(messages: ChatCompletionMessage[], maxTokens: number) {
  const leadingSystem: ChatCompletionMessage[] = [];
  let index = 0;
  while (messages[index]?.role === "system") leadingSystem.push(messages[index++]!);
  const systemTokens = leadingSystem.reduce((sum, message) => sum + estimateTokens(message), 0);
  if (systemTokens >= maxTokens) throw new Error("LLM_SYSTEM_PROMPT_QUOTA_EXCEEDED");
  let tokens = systemTokens;
  const recent: ChatCompletionMessage[] = [];
  for (const message of messages.slice(index).reverse()) {
    const next = estimateTokens(message);
    if (tokens + next > maxTokens) continue;
    tokens += next;
    recent.push(message);
  }
  return [...leadingSystem, ...recent.reverse()];
}

function validateWorldJsonOutput(
  text: string,
  validate: ReturnType<typeof compilePrimeWorldJsonSchema>,
  validator: JsonValue | undefined,
  validatorConfig: JsonValue | undefined,
  state: JsonObject,
): { value?: JsonValue; issues: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { issues: ["输出不是合法 JSON。"] };
  }
  if (!validate(parsed))
    return {
      issues: (validate.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "不符合 schema"}`,
      ),
    };
  const semanticIssues =
    validator === "immersive-novel-v1"
      ? validateImmersiveNovel(parsed, validatorConfig, state)
      : [];
  return semanticIssues.length
    ? { issues: semanticIssues }
    : { value: parsed as JsonValue, issues: [] };
}

function validateImmersiveNovel(value: unknown, rawConfig: JsonValue | undefined, state: JsonObject): string[] {
  const issues: string[] = [];
  if (!isObject(value)) return ["根值必须是对象。"];
  if (!Array.isArray(value.choices) || value.choices.length !== 3)
    return ["choices 必须恰好包含三个选项。"];
  const ids = value.choices.map((choice) => isObject(choice) ? choice.id : undefined);
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== 3)
    issues.push("choices 的 id 必须是三个互不重复的字符串。");
  if (!isObject(value.statePatch)) return [...issues, "statePatch 必须是对象。"];
  const patch = value.statePatch;
  issues.push(...validateImmersiveStatePatchIssues(patch, rawConfig, state));
  if (issues.length) return issues;
  for (const key of ["setFlags", "removeFlags", "inventoryAdd", "inventoryRemove"])
    if (Array.isArray(patch[key])) patch[key] = [...new Set(patch[key].map(String))];
  return [];
}

function validateImmersiveStatePatch(patch: JsonObject, rawConfig: JsonValue | undefined, state: JsonObject) {
  return validateImmersiveStatePatchIssues(patch, rawConfig, state).length === 0;
}

function validateImmersiveStatePatchIssues(patch: JsonObject, rawConfig: JsonValue | undefined, state: JsonObject) {
  const issues: string[] = [];
  if (patch.chapterIndexDelta !== 0 && patch.chapterIndexDelta !== 1)
    issues.push("chapterIndexDelta 只能是 0 或 1。");
  const config = isObject(rawConfig) ? rawConfig : {};
  const story = isObject(state.story) ? state.story : state;
  if (story.status === "ending") issues.push("故事已经结束，不能继续推进。");
  const stages = isObject(config.stages) ? config.stages : {};
  if (typeof patch.nextStageId === "string") {
    const current = String(story.stageId ?? "");
    const allowed = Array.isArray(stages[current]) ? stages[current].map(String) : [];
    if (!allowed.includes(patch.nextStageId))
      issues.push(`nextStageId 必须是当前阶段 ${current} 的合法后继：${allowed.join("、") || "无"}。`);
  }
  const characters = new Set(Array.isArray(config.characterIds) ? config.characterIds.map(String) : Object.keys(isObject(story.characterStates) ? story.characterStates : {}));
  if (Array.isArray(patch.characterChanges) && patch.characterChanges.some((change) => !isObject(change) || typeof change.characterId !== "string" || !characters.has(change.characterId)))
    issues.push(`characterChanges 只能引用角色：${[...characters].join("、")}。`);
  const flagIds = new Set(Array.isArray(config.flagIds) ? config.flagIds.map(String) : []);
  if (flagIds.size)
    for (const key of ["setFlags", "removeFlags"])
      if (Array.isArray(patch[key]) && patch[key].some((flag) => !flagIds.has(String(flag))))
        issues.push(`${key} 只能引用旗标：${[...flagIds].join("、")}。`);
  return issues;
}

function applyImmersiveNovelPatch(target: JsonObject, patch: JsonObject) {
  const story = isObject(target.story) ? target.story : target;
  if (patch.chapterIndexDelta !== 0 && patch.chapterIndexDelta !== 1) return false;
  if (typeof patch.nextStageId === "string") {
    story.stageId = patch.nextStageId;
    if (patch.nextStageId.startsWith("ending_")) story.status = "ending";
  }
  if (typeof patch.location === "string") story.location = patch.location;
  story.chapterIndex = Number(story.chapterIndex ?? 0) + Number(patch.chapterIndexDelta);
  const flags = isObject(story.flags) ? story.flags : {};
  for (const key of Array.isArray(patch.setFlags) ? patch.setFlags.map(String) : []) flags[key] = true;
  for (const key of Array.isArray(patch.removeFlags) ? patch.removeFlags.map(String) : []) delete flags[key];
  story.flags = flags;
  const inventory = new Set(Array.isArray(story.inventory) ? story.inventory.map(String) : []);
  for (const item of Array.isArray(patch.inventoryAdd) ? patch.inventoryAdd.map(String) : []) inventory.add(item);
  for (const item of Array.isArray(patch.inventoryRemove) ? patch.inventoryRemove.map(String) : []) inventory.delete(item);
  story.inventory = [...inventory];
  const characterStates = isObject(story.characterStates) ? story.characterStates : {};
  for (const raw of Array.isArray(patch.characterChanges) ? patch.characterChanges : []) {
    if (!isObject(raw) || typeof raw.characterId !== "string" || !isObject(characterStates[raw.characterId])) return false;
    const character = characterStates[raw.characterId] as JsonObject;
    const trust = Number(character.trust ?? 0) + Number(raw.trustDelta ?? 0);
    if (!Number.isFinite(trust)) return false;
    character.trust = trust;
    if (typeof raw.present === "boolean") character.present = raw.present;
  }
  story.characterStates = characterStates;
  if (isObject(target.story)) target.story = story;
  return true;
}

function applyRestrictedPatch(target: JsonObject, patch: JsonObject, allowed: Set<string>) {
  for (const [path, value] of Object.entries(patch)) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (![...allowed].some((allowedPath) => normalized === allowedPath || normalized.startsWith(`${allowedPath}/`))) return false;
    setPointer(target, normalized, value);
  }
  return true;
}

function normalizeAudio(payload: JsonObject): JsonObject {
  const candidate = isObject(payload.audio) ? payload.audio : payload;
  return { resourceId: String(candidate.resourceId ?? ""), ...(typeof candidate.mimeType === "string" ? { mimeType: candidate.mimeType } : {}) };
}

function asAudio(value: RuntimeValue): AudioValue {
  if (!isObject(value) || typeof value.resourceId !== "string" || !value.resourceId) throw new Error("INVALID_AUDIO_VALUE");
  return { resourceId: value.resourceId, ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}) };
}
function asTextStream(value: RuntimeValue) { if (!(value instanceof ReplayStream)) throw new Error("INVALID_TEXT_STREAM"); return value as ReplayStream<string>; }
function asAudioStream(value: RuntimeValue) { if (!(value instanceof ReplayStream)) throw new Error("INVALID_AUDIO_STREAM"); return value as ReplayStream<Buffer>; }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function isObject(value: unknown): value is JsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value) && !(value instanceof ReplayStream); }

function resolveDeep(value: JsonValue, context: { input: JsonObject; state: JsonObject }): JsonValue {
  if (typeof value === "string") return interpolate(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDeep(item, context)]));
  return value;
}
function interpolate(value: string, context: { input: JsonObject; state: JsonObject }) { return value.replace(/{{\s*(input|state)\.([\w./-]+)\s*}}/g, (_, root: "input" | "state", path: string) => String(readPointer(context[root], path) ?? "")); }
function readPointer(object: JsonObject, path: string): JsonValue | undefined { return path.split(/[./]/).filter(Boolean).reduce<JsonValue | undefined>((value, key) => value && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined, object); }
function setPointer(object: JsonObject, path: string, value: JsonValue) {
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("INVALID_STATE_PATH");
  let target = object;
  for (const part of parts.slice(0, -1)) { const next = target[part]; if (!next || typeof next !== "object" || Array.isArray(next)) target[part] = {}; target = target[part] as JsonObject; }
  target[parts.at(-1)!] = value;
}
function findElement(element: WorldViewElement, id: string): WorldViewElement | undefined { if (element.id === id) return element; if (element.type === "stack") for (const child of element.children) { const found = findElement(child, id); if (found) return found; } return undefined; }
function deepEqual(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function compare(operation: string, left: unknown, right: unknown) { return operation === "eq" ? deepEqual(left, right) : operation === "ne" ? !deepEqual(left, right) : operation === "gt" ? Number(left) > Number(right) : operation === "gte" ? Number(left) >= Number(right) : operation === "lt" ? Number(left) < Number(right) : Number(left) <= Number(right); }
function math(operation: string, left: number, right: number) { const value = operation === "add" ? left + right : operation === "subtract" ? left - right : operation === "multiply" ? left * right : operation === "divide" ? left / right : operation === "min" ? Math.min(left, right) : Math.max(left, right); if (!Number.isFinite(value)) throw new Error("INVALID_MATH_RESULT"); return value; }
function randomInRange(min: number, max: number, integer: boolean) { if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error("INVALID_RANDOM_RANGE"); const value = min + Math.random() * (max - min); return integer ? Math.floor(value) : value; }
function summarizeValue(value: RuntimeValue): JsonValue {
  if (value instanceof ReplayStream) return { kind: "stream" };
  if (Buffer.isBuffer(value)) return { kind: "buffer", bytes: value.byteLength };
  if (Array.isArray(value) && value.every((item) => isObject(item) && typeof item.role === "string"))
    return { kind: "messages", count: value.length, roles: value.map((item) => String((item as JsonObject).role)) };
  const safe = typeof value === "string" && value.length > 1024 ? `${value.slice(0, 1024)}…` : isObject(value) ? sanitizeJson(value) : value;
  const json = JSON.stringify(safe);
  return json.length > 1024 ? { kind: "truncated", preview: json.slice(0, 1024) } : safe as JsonValue;
}
function sanitizeJson(value: JsonObject) { return JSON.parse(JSON.stringify(value, (key, item) => /authorization|api[-_]?key|secret|(?:access|refresh)[-_]?token/i.test(key) ? "[redacted]" : item)) as JsonObject; }
function stableErrorCode(error: unknown) { if (error instanceof WorldRunCancelled || (error instanceof DOMException && error.name === "AbortError")) return "CANCELLED"; const message = error instanceof Error ? error.message : "RUN_FAILED"; return /^[A-Z][A-Z0-9_]+(?::|$)/.test(message) ? message.split(":")[0]! : "RUN_FAILED"; }
function safeError(error: unknown) { return (error instanceof Error ? error.message : "Unknown world error").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 2000); }
function toError(error: unknown) { return error instanceof Error ? error : new Error(String(error)); }
function isRetryableProviderError(error: unknown) {
  if (error instanceof WorldRunCancelled || (error instanceof DOMException && error.name === "AbortError")) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|\b5\d\d\b|network|fetch failed|ECONN|ETIMEDOUT|UND_ERR)/i.test(message);
}

export class WorldRunCancelled extends Error { constructor() { super("CANCELLED"); } }
