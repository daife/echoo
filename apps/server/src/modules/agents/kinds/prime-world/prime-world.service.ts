import { primeWorldViewSchema } from "@echoo/shared";
import type {
  JsonObject,
  JsonValue,
  PrimeWorldAgent,
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldExportBundle,
  PrimeWorldRuntimeState,
  WorldView,
  WorldViewElement,
} from "@echoo/shared";
import {
  AgentRunQueue,
  type AgentRunJob,
} from "../../../../infra/redis/run-queue.js";
import { AgentRepository } from "../../agent.repository.js";
import { AgentRunFailureRepository } from "../../agent-run-failure.repository.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { RuntimeConfigService } from "../../../runtime-config/runtime-config.service.js";
import type { StoredPrimeWorldRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { FishAudioSttService } from "../../../stt/fish-audio-stt.service.js";
import {
  compilePrimeWorld,
  validatePrimeWorldDefinition,
  type CompiledPrimeWorld,
} from "./prime-world-compiler.js";
import {
  materializePrimeWorldBundle,
  rewritePrimeWorldResourceIds,
} from "./prime-world-bundle.js";
import { PrimeWorldRepository } from "./prime-world.repository.js";
import {
  executePrimeWorldGraph,
  PrimeWorldAuthoredError,
  PrimeWorldExecutionFailure,
  type PrimeWorldHistoryDraft,
} from "./prime-world-executor.js";
import {
  collectPrimeWorldResourceIds,
  publicPrimeWorldNodeCatalog,
} from "./prime-world-node-registry.js";
import {
  publishPrimeWorldCancellation,
  registerPrimeWorldCancellation,
} from "./prime-world-cancellation.js";

type HistoryDraft = PrimeWorldHistoryDraft & {
  nodeId: string;
  channel: string;
  role: string;
  content: JsonObject;
};

export class PrimeWorldService {
  private readonly activeRuns = new Map<string, AbortController>();
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly worlds = new PrimeWorldRepository(),
    private readonly queue = new AgentRunQueue(),
    private readonly push = new AppPushService(),
    private readonly runtimeConfigs = new RuntimeConfigService(),
    private readonly providers = new AiProviderRegistry(),
    private readonly resources = new ResourceRepository(),
    private readonly stt = new FishAudioSttService(),
    private readonly failures = new AgentRunFailureRepository(),
  ) {}

  async snapshot(ownerUserId: string, conversationId: string) {
    await this.requireWorld(ownerUserId, conversationId);
    const state = await this.worlds.getState(ownerUserId, conversationId);
    if (!state) return null;
    const run = await this.worlds.getLatestRun(ownerUserId, conversationId);
    return {
      state: state.state,
      stateVersion: state.version,
      run,
      ...(run
        ? {
            resources: await this.worlds.listRunResources(
              ownerUserId,
              conversationId,
              run.id,
            ),
          }
        : {}),
    };
  }

  catalog() {
    return publicPrimeWorldNodeCatalog();
  }

  async getRun(ownerUserId: string, conversationId: string, runId: string) {
    await this.requireWorld(ownerUserId, conversationId);
    const run = await this.worlds.getRun(ownerUserId, runId);
    return run?.conversationId === conversationId ? run : null;
  }

  async getTrace(ownerUserId: string, conversationId: string, runId: string) {
    const agent = await this.requireWorld(ownerUserId, conversationId);
    if (agent.origin.kind !== "original") return null;
    const run = await this.worlds.getRun(ownerUserId, runId);
    if (run?.conversationId !== conversationId) return null;
    return run
      ? this.worlds.listTrace(ownerUserId, conversationId, runId)
      : null;
  }

  async reset(ownerUserId: string, conversationId: string) {
    const agent = await this.requireWorld(ownerUserId, conversationId);
    const active = await this.worlds.cancelOtherActiveRuns(
      ownerUserId,
      conversationId,
      "",
    );
    await Promise.all(
      active.map((runId) => publishPrimeWorldCancellation(runId)),
    );
    for (const runId of active)
      this.publish(ownerUserId, "world.run.cancelled", conversationId, runId);
    const reset = await this.worlds.resetConversation({
      ownerUserId,
      conversationId,
      definition: agent.detail,
    });
    await this.queue
      .enqueue({
        ownerUserId,
        conversationId,
        kind: "prime-world",
        runId: reset.runId,
      })
      .catch(() => undefined);
    return reset;
  }

  async exportBundle(
    ownerUserId: string,
    conversationId: string,
  ): Promise<PrimeWorldExportBundle> {
    const agent = await this.requireWorld(ownerUserId, conversationId);
    const detail = structuredClone(agent.detail);
    detail.definitionRevision = 0;
    const resourceIds = collectPrimeWorldResourceIds(
      detail.workflow.nodes,
      detail.presentation.startView,
    );
    const replacements = new Map<string, string>();
    const resources: PrimeWorldExportBundle["resources"] = [];
    for (const [index, resourceId] of resourceIds.entries()) {
      const value = await this.resources.readForOwner(ownerUserId, resourceId);
      if (!value || value.record.status !== "ready")
        throw new Error(`WORLD_RESOURCE_NOT_READY:${resourceId}`);
      const key = `resource-${index + 1}`;
      replacements.set(resourceId, key);
      resources.push({
        key,
        usageKind: "world",
        mimeType: value.record.mimeType,
        fileName: value.record.originalFileName,
        dataBase64: value.data.toString("base64"),
      });
    }
    rewritePrimeWorldResourceIds(detail as unknown as JsonValue, (id) =>
      replacements.has(id) ? `bundle:${replacements.get(id)}` : id,
    );
    return {
      format: "echoo-prime-world",
      formatVersion: 1,
      name: agent.name,
      attributes: agent.attributes,
      tags: agent.tags,
      introduction: agent.introduction,
      isPublic: agent.isPublic,
      detail,
      resources,
    };
  }

  async importBundle(ownerUserId: string, input: unknown) {
    const materialized = await materializePrimeWorldBundle(
      ownerUserId,
      input,
      this.resources,
    );
    try {
      return await this.agents.create(ownerUserId, materialized.request);
    } catch (error) {
      await materialized.cleanup();
      throw error;
    }
  }

  validate(detail: PrimeWorldDetail) {
    return validatePrimeWorldDefinition(detail);
  }

  async dispatch(
    ownerUserId: string,
    conversationId: string,
    event: PrimeWorldEventInput,
  ) {
    const agent = await this.requireWorld(ownerUserId, conversationId);
    compilePrimeWorld(agent.detail);
    if (Buffer.byteLength(JSON.stringify(event), "utf8") > 64 * 1024)
      throw new Error("EVENT_QUOTA_EXCEEDED");
    if (event.type === "input.voice") {
      const resourceId =
        typeof event.payload?.resourceId === "string"
          ? event.payload.resourceId
          : "";
      const resource = resourceId
        ? await this.resources.findById(resourceId)
        : null;
      if (
        !resource ||
        resource.ownerUserId !== ownerUserId ||
        resource.status !== "ready" ||
        !resource.mimeType.startsWith("audio/")
      )
        throw new Error("WORLD_AUDIO_RESOURCE_INVALID");
    }
    const created = await this.worlds.createEventAndRun({
      ownerUserId,
      conversationId,
      definition: agent.detail,
      event,
    });
    if (created.created) {
      if (event.interruptCurrent) {
        const cancelled = await this.worlds.cancelOtherActiveRuns(
          ownerUserId,
          conversationId,
          created.run.id,
        );
        await Promise.all(
          cancelled.map((runId) => publishPrimeWorldCancellation(runId)),
        );
        for (const runId of cancelled)
          this.publish(
            ownerUserId,
            "world.run.cancelled",
            conversationId,
            runId,
          );
      }
      await this.queue
        .enqueue({
          ownerUserId,
          conversationId,
          kind: "prime-world",
          runId: created.run.id,
        })
        .catch(() => undefined);
    }
    return created.run;
  }

  async processQueuedRun(job: AgentRunJob) {
    if (job.kind !== "prime-world" || !job.runId) return;
    const input = await this.worlds.getExecutionInput(
      job.ownerUserId,
      job.conversationId,
      job.runId,
    );
    if (!input || input.run.status !== "queued") return;
    const stored = await this.worlds.getState(
      job.ownerUserId,
      job.conversationId,
    );
    if (!stored) throw new Error("WORLD_STATE_NOT_FOUND");
    if (
      input.event.expectedViewRevision !== undefined &&
      input.event.expectedViewRevision !== stored.state.view.revision
    ) {
      await this.worlds.fail(
        job.ownerUserId,
        job.runId,
        "STALE_VIEW",
        "操作来自过期的世界视图。",
      );
      this.publish(
        job.ownerUserId,
        "world.run.failed",
        job.conversationId,
        job.runId,
        { errorCode: "STALE_VIEW" },
      );
      return;
    }
    if (
      !(await this.worlds.startRun(job.ownerUserId, job.runId, stored.version))
    )
      return;
    const abort = new AbortController();
    this.activeRuns.set(job.runId, abort);
    const unregisterCancellation = await registerPrimeWorldCancellation(
      job.runId,
      abort,
    );
    this.publish(
      job.ownerUserId,
      "world.run.started",
      job.conversationId,
      job.runId,
    );
    let executionResult:
      Awaited<ReturnType<typeof executePrimeWorldGraph>> | undefined;
    try {
      const compiled = compilePrimeWorld(input.definition);
      const draft = structuredClone(stored.state);
      const history: HistoryDraft[] = [];
      const resolvedConfig =
        await this.runtimeConfigs.resolveConversationConfig(
          job.ownerUserId,
          job.conversationId,
        );
      const traceEnabled =
        (await this.requireWorld(job.ownerUserId, job.conversationId)).origin
          .kind === "original";
      executionResult = await executePrimeWorldGraph(
        compiled,
        draft,
        input.event,
        history,
        abort.signal,
        {
          ownerUserId: job.ownerUserId,
          conversationId: job.conversationId,
          runId: job.runId,
          runtimeConfig: resolvedConfig.config as StoredPrimeWorldRuntimeConfig,
          worlds: this.worlds,
          providers: this.providers,
          resources: this.resources,
          stt: this.stt,
          push: this.push,
          traceEnabled,
        },
      );
      if (abort.signal.aborted) throw new WorldRunCancelled();
      const stateVersion = await this.worlds.commit({
        ownerUserId: job.ownerUserId,
        conversationId: job.conversationId,
        runId: job.runId,
        beforeVersion: stored.version,
        state: draft,
        history,
        timers: executionResult.timers,
        resources: executionResult.resources,
        trace: executionResult.trace,
      });
      this.publish(
        job.ownerUserId,
        "world.view.committed",
        job.conversationId,
        job.runId,
        { view: draft.view, stateVersion },
      );
      this.publish(
        job.ownerUserId,
        "world.run.completed",
        job.conversationId,
        job.runId,
        { stateVersion },
      );
    } catch (error) {
      const failure =
        error instanceof PrimeWorldExecutionFailure ? error : undefined;
      const cause = failure?.original ?? error;
      executionResult = failure?.partial ?? executionResult;
      if (executionResult) {
        await this.worlds
          .saveTrace({
            ownerUserId: job.ownerUserId,
            conversationId: job.conversationId,
            runId: job.runId,
            trace: executionResult.trace,
          })
          .catch(() => undefined);
        await executionResult.cleanup();
      }
      if (
        cause instanceof WorldRunCancelled ||
        abort.signal.aborted ||
        (cause instanceof Error && cause.message === "RUN_CANCELLED")
      ) {
        await this.worlds.cancel(
          job.ownerUserId,
          job.conversationId,
          job.runId,
        );
        this.publish(
          job.ownerUserId,
          "world.run.cancelled",
          job.conversationId,
          job.runId,
        );
      } else {
        const authored =
          cause instanceof PrimeWorldAuthoredError ? cause : undefined;
        const code = authored?.code ?? stableWorldErrorCode(cause);
        const detail =
          authored?.userMessage ??
          (cause instanceof Error ? cause.message : "Unknown world error");
        await this.worlds.fail(job.ownerUserId, job.runId, code, detail);
        await this.failures.record({
          ownerUserId: job.ownerUserId,
          conversationId: job.conversationId,
          kind: "prime-world",
          runId: job.runId,
          phase: "world_execution",
          errorMessage: detail,
          diagnostics: { errorCode: code },
        });
        this.publish(
          job.ownerUserId,
          "world.run.failed",
          job.conversationId,
          job.runId,
          { errorCode: code, message: detail },
        );
      }
    } finally {
      unregisterCancellation();
      this.activeRuns.delete(job.runId);
    }
  }

  async cancel(ownerUserId: string, conversationId: string, runId: string) {
    await this.requireWorld(ownerUserId, conversationId);
    await publishPrimeWorldCancellation(runId);
    const cancelled = await this.worlds.cancel(
      ownerUserId,
      conversationId,
      runId,
    );
    if (cancelled)
      this.publish(ownerUserId, "world.run.cancelled", conversationId, runId);
    return cancelled;
  }

  async recoverQueuedRuns() {
    const queued = await this.worlds.listQueuedRuns(Date.now() - 5_000);
    await Promise.allSettled(
      queued.map((run) =>
        this.queue.enqueue({
          ...run,
          ownerUserId: run.ownerUserId,
          conversationId: run.conversationId,
          kind: "prime-world",
        }),
      ),
    );
    return queued.length;
  }

  async dispatchDueTimers() {
    const due = await this.worlds.claimDueTimers();
    for (const timer of due) {
      try {
        await this.dispatch(timer.ownerUserId, timer.conversationId, {
          clientEventId: `timer:${timer.id}`,
          type: "timer.fired",
          payload: { triggerKey: timer.triggerKey, ...timer.payload },
        });
        await this.worlds.markTimerFired(timer.id);
      } catch (error) {
        console.warn(
          "Prime World timer dispatch failed; lease will retry.",
          error,
        );
      }
    }
    return due.length;
  }

  private publish(
    ownerUserId: string,
    type: string,
    conversationId: string,
    runId: string,
    extra: Record<string, unknown> = {},
  ) {
    this.push.pushToUser(ownerUserId, {
      type,
      conversationId,
      runId,
      ...extra,
    });
  }
  private async requireWorld(ownerUserId: string, conversationId: string) {
    const agent = await this.agents.findByConversation(
      ownerUserId,
      conversationId,
    );
    if (!agent || agent.type !== "prime-world")
      throw new Error("WORLD_NOT_FOUND");
    return agent;
  }
}

export async function executePrimeWorld(
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  event: PrimeWorldEventInput,
  history: HistoryDraft[],
  signal?: AbortSignal,
) {
  return executePrimeWorldGraph(compiled, draft, event, history, signal);
}

async function executePrimeWorldLegacy(
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  event: PrimeWorldEventInput,
  history: HistoryDraft[],
  signal?: AbortSignal,
) {
  const triggerType = (
    {
      "world.start": "trigger.worldStart",
      "ui.action": "trigger.uiAction",
      "input.text": "trigger.textInput",
      "input.voice": "trigger.voiceInput",
      "timer.fired": "trigger.timer",
    } as Record<string, string>
  )[event.type];
  const triggers = [...compiled.nodes.values()].filter(
    (node) => node.type === triggerType,
  );
  if (!triggers.length) throw new Error(`MISSING_TRIGGER:${triggerType}`);
  const values = new Map<string, JsonValue>();
  const visited = new Set<string>();
  const context = { input: event.payload ?? {}, state: draft.variables };
  for (const trigger of triggers) {
    values.set(`${trigger.id}:event`, context.input);
    values.set(`${trigger.id}:payload`, context.input.payload ?? context.input);
    values.set(`${trigger.id}:actionId`, context.input.actionId ?? "");
    values.set(`${trigger.id}:text`, context.input.text ?? "");
    values.set(`${trigger.id}:transcript`, context.input.transcript ?? "");
    await runControl(
      trigger.id,
      compiled,
      draft,
      context,
      history,
      values,
      visited,
      signal,
    );
  }
}

async function runControl(
  id: string,
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  context: { input: JsonObject; state: JsonObject },
  history: HistoryDraft[],
  values: Map<string, JsonValue>,
  visited: Set<string>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new WorldRunCancelled();
  if (visited.has(id)) return;
  visited.add(id);
  const node = compiled.nodes.get(id);
  if (!node) return;
  const input = (port: string, fallback?: JsonValue) =>
    resolveInput(node.id, port, compiled, draft, context, values, fallback);
  let outputs = ["control"];
  if (node.type === "state.set")
    setPointer(
      draft.variables,
      String(node.config.path),
      await input("value", resolveDeep(node.config.value ?? null, context)),
    );
  else if (node.type === "data.template")
    values.set(
      `${id}:text`,
      interpolate(String(node.config.template), context),
    );
  else if (node.type === "data.object")
    values.set(`${id}:value`, resolveDeep(node.config.value ?? {}, context));
  else if (node.type === "logic.if")
    outputs = deepEqual(
      await input("value", resolveDeep(node.config.value ?? null, context)),
      resolveDeep(node.config.equals ?? true, context),
    )
      ? ["true"]
      : ["false"];
  else if (node.type === "logic.switch") {
    const selected = String(
      await input("value", resolveDeep(node.config.value ?? null, context)),
    );
    const cases = node.config.cases as JsonObject;
    outputs = [
      typeof cases[selected] === "string"
        ? (cases[selected] as string)
        : "default",
    ];
  } else if (node.type === "math.operation")
    values.set(
      `${id}:value`,
      math(
        String(node.config.operation),
        Number(await input("left", node.config.left ?? 0)),
        Number(await input("right", node.config.right ?? 0)),
      ),
    );
  else if (node.type === "math.random")
    values.set(
      `${id}:value`,
      randomInRange(
        Number(node.config.min ?? 0),
        Number(node.config.max ?? 1),
        Boolean(node.config.integer),
      ),
    );
  else if (node.type === "view.render") {
    const view = primeWorldViewSchema.parse(
      await input("view", resolveDeep(node.config.view ?? null, context)),
    ) as WorldView;
    draft.view = {
      ...structuredClone(view),
      revision: draft.view.revision + 1,
    };
  } else if (node.type === "view.patch") {
    const element = findElement(draft.view.root, String(node.config.elementId));
    if (!element)
      throw new Error(
        `VIEW_ELEMENT_NOT_FOUND:${String(node.config.elementId)}`,
      );
    const patch = resolveDeep(node.config.patch ?? {}, context);
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      "id" in patch ||
      "type" in patch
    )
      throw new Error("INVALID_VIEW_PATCH");
    Object.assign(element, patch);
    primeWorldViewSchema.parse(draft.view);
    draft.view = { ...draft.view, revision: draft.view.revision + 1 };
  } else if (node.type === "history.append") {
    const content = await input(
      "content",
      resolveDeep(node.config.content ?? node.config.text ?? "", context),
    );
    history.push({
      nodeId: node.id,
      channel: String(node.config.channel ?? "default"),
      role: String(node.config.role ?? "user"),
      content:
        content && typeof content === "object" && !Array.isArray(content)
          ? (content as JsonObject)
          : { value: content },
    });
  }
  for (const output of outputs)
    for (const edge of compiled.outgoing.get(`${id}:${output}`) ?? [])
      if (edge.kind === "control")
        await runControl(
          edge.target.nodeId,
          compiled,
          draft,
          context,
          history,
          values,
          visited,
          signal,
        );
}

async function resolveInput(
  nodeId: string,
  port: string,
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  context: { input: JsonObject; state: JsonObject },
  values: Map<string, JsonValue>,
  fallback: JsonValue = null,
): Promise<JsonValue> {
  const edge = compiled.incoming
    .get(`${nodeId}:${port}`)
    ?.find((item) => item.kind === "data");
  return edge
    ? evaluateData(
        edge.source.nodeId,
        edge.source.port,
        compiled,
        draft,
        context,
        values,
      )
    : fallback;
}
async function evaluateData(
  nodeId: string,
  port: string,
  compiled: CompiledPrimeWorld,
  draft: PrimeWorldRuntimeState,
  context: { input: JsonObject; state: JsonObject },
  values: Map<string, JsonValue>,
): Promise<JsonValue> {
  const key = `${nodeId}:${port}`;
  if (values.has(key)) return values.get(key)!;
  const node = compiled.nodes.get(nodeId);
  if (!node) throw new Error(`DATA_NODE_NOT_FOUND:${nodeId}`);
  let value: JsonValue;
  if (node.type === "state.get")
    value = readPointer(draft.variables, String(node.config.path)) ?? null;
  else if (node.type === "data.constant")
    value = resolveDeep(node.config.value ?? null, context);
  else if (node.type === "data.template")
    value = interpolate(String(node.config.template), context);
  else if (node.type === "data.pick") {
    const source = await resolveInput(
      node.id,
      "source",
      compiled,
      draft,
      context,
      values,
      node.config.source ?? {},
    );
    value =
      source && typeof source === "object" && !Array.isArray(source)
        ? (readPointer(source as JsonObject, String(node.config.path)) ?? null)
        : null;
  } else if (node.type === "data.object")
    value = resolveDeep(node.config.value ?? {}, context);
  else throw new Error(`DATA_NOT_READY:${nodeId}:${port}`);
  values.set(key, value);
  return value;
}

function resolveDeep(
  value: JsonValue,
  context: { input: JsonObject; state: JsonObject },
): JsonValue {
  if (typeof value === "string") return interpolate(value, context);
  if (Array.isArray(value))
    return value.map((item) => resolveDeep(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveDeep(item, context),
      ]),
    );
  return value;
}
function interpolate(
  value: string,
  context: { input: JsonObject; state: JsonObject },
) {
  return value.replace(
    /{{\s*(input|state)\.([\w./-]+)\s*}}/g,
    (_, root: "input" | "state", path: string) =>
      String(readPointer(context[root], path) ?? ""),
  );
}
function readPointer(object: JsonObject, path: string): JsonValue | undefined {
  return path
    .split(/[./]/)
    .filter(Boolean)
    .reduce<JsonValue | undefined>(
      (current, part) =>
        current && typeof current === "object" && !Array.isArray(current)
          ? current[part]
          : undefined,
      object,
    );
}
function setPointer(object: JsonObject, path: string, value: JsonValue) {
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  if (
    !parts.length ||
    parts.some(
      (part) =>
        part === "__proto__" || part === "constructor" || part === "prototype",
    )
  )
    throw new Error("INVALID_STATE_PATH");
  let target: JsonObject = object;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (!next || typeof next !== "object" || Array.isArray(next))
      target[part] = {};
    target = target[part] as JsonObject;
  }
  target[parts[parts.length - 1]!] = value;
}
function findElement(
  element: WorldViewElement,
  id: string,
): WorldViewElement | undefined {
  if (element.id === id) return element;
  if (element.type === "stack")
    for (const child of element.children) {
      const found = findElement(child, id);
      if (found) return found;
    }
  return undefined;
}
function deepEqual(left: JsonValue, right: JsonValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function math(operation: string, left: number, right: number) {
  const value =
    operation === "add"
      ? left + right
      : operation === "subtract"
        ? left - right
        : operation === "multiply"
          ? left * right
          : operation === "divide"
            ? left / right
            : operation === "min"
              ? Math.min(left, right)
              : Math.max(left, right);
  if (!Number.isFinite(value)) throw new Error("INVALID_MATH_RESULT");
  return value;
}
function randomInRange(min: number, max: number, integer: boolean) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
    throw new Error("INVALID_RANDOM_RANGE");
  const value = min + Math.random() * (max - min);
  return integer ? Math.floor(value) : value;
}
class WorldRunCancelled extends Error {}

function stableWorldErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "RUN_FAILED";
  if (error.message === "STATE_CONFLICT") return "STATE_CONFLICT";
  return /^[A-Z][A-Z0-9_]+(?::|$)/.test(error.message)
    ? error.message.split(":")[0]!
    : "RUN_FAILED";
}
