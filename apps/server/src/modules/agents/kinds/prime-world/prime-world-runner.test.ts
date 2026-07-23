import assert from "node:assert/strict";
import test from "node:test";
import { fogHarborLettersFixture } from "@echoo/shared";
import type { JsonObject, PrimeWorldDetail, PrimeWorldRuntimeState } from "@echoo/shared";
import type { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";
import type { ResourceRepository } from "../../../resources/resource.repository.js";
import { compilePrimeWorld } from "./prime-world-compiler.js";
import {
  executePrimeWorldGraph,
  PrimeWorldAuthoredError,
  PrimeWorldExecutionFailure,
} from "./prime-world-executor.js";
import type { PrimeWorldRepository } from "./prime-world.repository.js";
import { executePrimeWorld } from "./prime-world.service.js";

const view = (text: string) => ({
  revision: 0,
  root: { id: "text", type: "text" as const, text },
});
const detail: PrimeWorldDetail = {
  schemaVersion: 1,
  definitionRevision: 1,
  initialState: {},
  presentation: { theme: "dark", startView: view("start") },
  workflow: {
    version: 1,
    editor: { positions: {} },
    nodes: [
      { id: "action", type: "trigger.uiAction", version: 1, config: {} },
      {
        id: "branch",
        type: "logic.switch",
        version: 1,
        config: {
          value: "{{input.choiceId}}",
          cases: { left: "left", right: "right" },
        },
      },
      {
        id: "left",
        type: "state.set",
        version: 1,
        config: { path: "/path", value: "left" },
      },
      {
        id: "right",
        type: "state.set",
        version: 1,
        config: { path: "/path", value: "right" },
      },
      {
        id: "left-view",
        type: "view.render",
        version: 1,
        config: { view: view("left") },
      },
      {
        id: "right-view",
        type: "view.render",
        version: 1,
        config: { view: view("right") },
      },
    ],
    edges: [
      {
        id: "1",
        kind: "control",
        source: { nodeId: "action", port: "control" },
        target: { nodeId: "branch", port: "control" },
      },
      {
        id: "2",
        kind: "control",
        source: { nodeId: "branch", port: "left" },
        target: { nodeId: "left", port: "control" },
      },
      {
        id: "3",
        kind: "control",
        source: { nodeId: "left", port: "control" },
        target: { nodeId: "left-view", port: "control" },
      },
      {
        id: "4",
        kind: "control",
        source: { nodeId: "branch", port: "right" },
        target: { nodeId: "right", port: "control" },
      },
      {
        id: "5",
        kind: "control",
        source: { nodeId: "right", port: "control" },
        target: { nodeId: "right-view", port: "control" },
      },
    ],
  },
};

test("executes only the selected control branch", async () => {
  const state: PrimeWorldRuntimeState = {
    schemaVersion: 1,
    variables: {},
    view: view("start"),
    summaries: {},
    updatedAt: 0,
  };
  await executePrimeWorld(
    compilePrimeWorld(detail),
    state,
    {
      clientEventId: "event",
      type: "ui.action",
      payload: { choiceId: "right" },
    },
    [],
  );
  assert.equal(state.variables.path, "right");
  assert.equal(
    state.view.root.type === "text" ? state.view.root.text : "",
    "right",
  );
  assert.equal(state.view.revision, 1);
});

test("broadcasts deterministic Unicode text chunks to multiple stream collectors", async () => {
  const streamDetail: PrimeWorldDetail = {
    ...detail,
    workflow: {
      version: 1,
      editor: { positions: {} },
      nodes: [
        { id: "input", type: "trigger.textInput", version: 1, config: {} },
        { id: "stream", type: "convert.textToStream", version: 1, config: { chunkCharacters: 2 } },
        { id: "collect-a", type: "convert.textFromStream", version: 1, config: {} },
        { id: "collect-b", type: "convert.textFromStream", version: 1, config: {} },
      ],
      edges: [
        { id: "c1", kind: "control", source: { nodeId: "input", port: "control" }, target: { nodeId: "stream", port: "control" } },
        { id: "c2", kind: "control", source: { nodeId: "stream", port: "control" }, target: { nodeId: "collect-a", port: "control" } },
        { id: "c3", kind: "control", source: { nodeId: "stream", port: "control" }, target: { nodeId: "collect-b", port: "control" } },
        { id: "d1", kind: "data", source: { nodeId: "input", port: "text" }, target: { nodeId: "stream", port: "text" } },
        { id: "d2", kind: "data", source: { nodeId: "stream", port: "textStream" }, target: { nodeId: "collect-a", port: "textStream" } },
        { id: "d3", kind: "data", source: { nodeId: "stream", port: "textStream" }, target: { nodeId: "collect-b", port: "textStream" } },
      ],
    },
  };
  const state: PrimeWorldRuntimeState = { schemaVersion: 1, variables: {}, view: view("start"), summaries: {}, updatedAt: 0 };
  const result = await executePrimeWorld(
    compilePrimeWorld(streamDetail),
    state,
    { clientEventId: "unicode", type: "input.text", payload: { text: "你🙂好world" } },
    [],
  );
  const collected = result.trace.filter((entry) => entry.nodeType === "convert.textFromStream" && entry.phase === "completed");
  assert.equal(collected.length, 2);
  assert.deepEqual(collected.map((entry) => entry.outputSummary?.text), ["你🙂好world", "你🙂好world"]);
});

test("round-trips complete audio through explicit stream conversion", async () => {
  const audioDetail: PrimeWorldDetail = {
    ...detail,
    workflow: {
      version: 1,
      editor: { positions: {} },
      nodes: [
        { id: "voice", type: "trigger.voiceInput", version: 1, config: {} },
        { id: "to-stream", type: "convert.audioToStream", version: 1, config: { chunkBytes: 1024 } },
        { id: "from-stream", type: "convert.audioFromStream", version: 1, config: {} },
      ],
      edges: [
        { id: "c1", kind: "control", source: { nodeId: "voice", port: "control" }, target: { nodeId: "to-stream", port: "control" } },
        { id: "c2", kind: "control", source: { nodeId: "to-stream", port: "control" }, target: { nodeId: "from-stream", port: "control" } },
        { id: "d1", kind: "data", source: { nodeId: "voice", port: "audio" }, target: { nodeId: "to-stream", port: "audio" } },
        { id: "d2", kind: "data", source: { nodeId: "to-stream", port: "audioStream" }, target: { nodeId: "from-stream", port: "audioStream" } },
      ],
    },
  };
  const bytes = Buffer.from("prime-world-audio".repeat(300));
  const resources = {
    async readForOwner() { return { record: { status: "ready" }, data: bytes }; },
    async saveGeneratedMedia() { return { id: "generated-audio", publicPath: "/generated/audio.mp3", mimeType: "audio/mpeg" }; },
    async deleteOwnedByPublicPath() { return true; },
  } as unknown as ResourceRepository;
  const state: PrimeWorldRuntimeState = { schemaVersion: 1, variables: {}, view: view("start"), summaries: {}, updatedAt: 0 };
  const result = await executePrimeWorldGraph(
    compilePrimeWorld(audioDetail),
    state,
    { clientEventId: "audio", type: "input.voice", payload: { resourceId: "source-audio" } },
    [],
    undefined,
    { ownerUserId: "user", conversationId: "conversation", runId: "run", resources, traceEnabled: false },
  );
  assert.deepEqual(result.resources.map((resource) => resource.resourceId), ["generated-audio"]);
});

test("runs the immersive novel fixture for 30 turns with rolling summaries", async () => {
  const state: PrimeWorldRuntimeState = {
    schemaVersion: 1,
    variables: structuredClone(fogHarborLettersFixture.initialState),
    view: structuredClone(fogHarborLettersFixture.presentation.startView),
    summaries: {},
    updatedAt: 0,
  };
  const stored: Array<{ sequence: number; channel: string; role: string; content: JsonObject; tokenEstimate: number }> = [];
  const worlds = {
    async readHistory(_owner: string, _conversation: string, input: { channel: string; roles: string[]; maxEntries: number; maxTokens: number }) {
      let tokens = 0;
      return stored.filter((entry) => entry.channel === input.channel && input.roles.includes(entry.role)).slice(-input.maxEntries).reverse().filter((entry) => {
        if (tokens + entry.tokenEstimate > input.maxTokens) return false;
        tokens += entry.tokenEstimate;
        return true;
      }).reverse();
    },
    async readHistoryAfter(_owner: string, _conversation: string, channel: string, after: number, limit = 128) {
      return stored.filter((entry) => entry.channel === channel && entry.sequence > after).slice(0, limit);
    },
  } as unknown as PrimeWorldRepository;
  let summaries = 0;
  const narrative = "雾港的潮声从石阶下缓慢上涨，林澈把一封没有署名的信推到灯下。".repeat(75);
  const providers = {
    createProvider: () => ({
      id: "fixture",
      async createChatCompletion(input: { responseFormat?: unknown }) {
        if (!input.responseFormat) {
          summaries += 1;
          return { providerId: "fixture", model: "summary", text: `滚动摘要 ${summaries}` };
        }
        return {
          providerId: "fixture",
          model: "main",
          text: JSON.stringify({
            narrative,
            choices: [
              { id: "inspect_letter", label: "检查信纸" },
              { id: "ask_lin", label: "询问林澈" },
              { id: "visit_dock", label: "前往旧码头" },
            ],
            statePatch: {
              chapterIndexDelta: 1,
              setFlags: [],
              removeFlags: [],
              inventoryAdd: [],
              inventoryRemove: [],
              characterChanges: [],
            },
          }),
        };
      },
    }),
  } as unknown as AiProviderRegistry;
  const compiled = compilePrimeWorld(fogHarborLettersFixture);
  for (let turn = 1; turn <= 30; turn += 1) {
    const history: Array<{ nodeId: string; channel: string; role: string; content: JsonObject }> = [];
    try {
      await executePrimeWorldGraph(
        compiled,
        state,
        { clientEventId: `turn-${turn}`, type: "input.text", payload: { text: `第 ${turn} 回合行动` } },
        history,
        undefined,
        {
          ownerUserId: "user",
          conversationId: "conversation",
          runId: `run-${turn}`,
          runtimeConfig: buildRuntimeConfigDefaults().primeWorld,
          providers,
          worlds,
          traceEnabled: false,
        },
      );
    } catch (error) {
      const trace = error instanceof PrimeWorldExecutionFailure ? error.partial.trace.slice(-4) : [];
      assert.fail(`turn ${turn}: ${error instanceof Error ? error.message : String(error)} ${JSON.stringify(trace)}`);
    }
    for (const entry of history) {
      const sequence = stored.length + 1;
      stored.push({ ...entry, sequence, tokenEstimate: Math.ceil(JSON.stringify(entry.content).length / 4) });
    }
  }
  const story = state.variables.story as Record<string, unknown>;
  assert.equal(story.chapterIndex, 30);
  assert.equal(stored.length, 60);
  assert.ok(summaries > 0);
  assert.ok((state.summaries.story?.throughSequence ?? 0) > 0);
  assert.equal(state.view.root.type === "stack" && state.view.root.children[1]?.type === "choices" ? state.view.root.children[1].choices.length : 0, 3);
});

test("repairs one invalid immersive-novel JSON response and commits the turn", async () => {
  const state: PrimeWorldRuntimeState = {
    schemaVersion: 1,
    variables: structuredClone(fogHarborLettersFixture.initialState),
    view: structuredClone(fogHarborLettersFixture.presentation.startView),
    summaries: {},
    updatedAt: 0,
  };
  let calls = 0;
  const providers = {
    createProvider: () => ({
      id: "repair-test",
      async createChatCompletion() {
        calls += 1;
        return {
          providerId: "repair-test",
          model: "main",
          text:
            calls === 1
              ? "{}"
              : JSON.stringify(validNovelOutput()),
        };
      },
    }),
  } as unknown as AiProviderRegistry;
  await executePrimeWorldGraph(
    compilePrimeWorld(fogHarborLettersFixture),
    state,
    { clientEventId: "repair", type: "input.text", payload: { text: "检查信件" } },
    [],
    undefined,
    {
      ownerUserId: "user",
      conversationId: "conversation",
      runId: "run-repair",
      runtimeConfig: buildRuntimeConfigDefaults().primeWorld,
      providers,
      worlds: emptyWorldHistory(),
      traceEnabled: false,
    },
  );
  assert.equal(calls, 2);
  assert.equal((state.variables.story as JsonObject).chapterIndex, 1);
});

test("reports WORLD_OUTPUT_INVALID after the repair response is still invalid", async () => {
  const state: PrimeWorldRuntimeState = {
    schemaVersion: 1,
    variables: structuredClone(fogHarborLettersFixture.initialState),
    view: structuredClone(fogHarborLettersFixture.presentation.startView),
    summaries: {},
    updatedAt: 0,
  };
  let calls = 0;
  const providers = {
    createProvider: () => ({
      id: "invalid-test",
      async createChatCompletion() {
        calls += 1;
        return { providerId: "invalid-test", model: "main", text: "{}" };
      },
    }),
  } as unknown as AiProviderRegistry;
  await assert.rejects(
    executePrimeWorldGraph(
      compilePrimeWorld(fogHarborLettersFixture),
      state,
      { clientEventId: "invalid", type: "input.text", payload: { text: "等待" } },
      [],
      undefined,
      {
        ownerUserId: "user",
        conversationId: "conversation",
        runId: "run-invalid",
        runtimeConfig: buildRuntimeConfigDefaults().primeWorld,
        providers,
        worlds: emptyWorldHistory(),
        traceEnabled: false,
      },
    ),
    (error) =>
      error instanceof PrimeWorldExecutionFailure &&
      error.original instanceof PrimeWorldAuthoredError &&
      error.original.code === "WORLD_OUTPUT_INVALID",
  );
  assert.equal(calls, 2);
});

test("reports WORLD_MODEL_ERROR without attempting output repair", async () => {
  const state: PrimeWorldRuntimeState = {
    schemaVersion: 1,
    variables: structuredClone(fogHarborLettersFixture.initialState),
    view: structuredClone(fogHarborLettersFixture.presentation.startView),
    summaries: {},
    updatedAt: 0,
  };
  let calls = 0;
  const providers = {
    createProvider: () => ({
      id: "model-error-test",
      async createChatCompletion() {
        calls += 1;
        throw new Error("provider unavailable");
      },
    }),
  } as unknown as AiProviderRegistry;

  await assert.rejects(
    executePrimeWorldGraph(
      compilePrimeWorld(fogHarborLettersFixture),
      state,
      { clientEventId: "model-error", type: "input.text", payload: { text: "等待" } },
      [],
      undefined,
      {
        ownerUserId: "user",
        conversationId: "conversation",
        runId: "run-model-error",
        runtimeConfig: buildRuntimeConfigDefaults().primeWorld,
        providers,
        worlds: emptyWorldHistory(),
        traceEnabled: false,
      },
    ),
    (error) =>
      error instanceof PrimeWorldExecutionFailure &&
      error.original instanceof PrimeWorldAuthoredError &&
      error.original.code === "WORLD_MODEL_ERROR",
  );
  assert.equal(calls, 1);
});

function validNovelOutput() {
  return {
    narrative: "雾港的灯火在潮湿石阶上摇晃，林澈把旧信纸推到灯下，等待你辨认其中被海水晕开的字迹。".repeat(3),
    choices: [
      { id: "inspect_letter", label: "检查信纸" },
      { id: "ask_lin", label: "询问林澈" },
      { id: "visit_dock", label: "前往旧码头" },
    ],
    statePatch: {
      chapterIndexDelta: 1,
      setFlags: [],
      removeFlags: [],
      inventoryAdd: [],
      inventoryRemove: [],
      characterChanges: [],
    },
  };
}

function emptyWorldHistory() {
  return {
    async readHistory() {
      return [];
    },
    async readHistoryAfter() {
      return [];
    },
  } as unknown as PrimeWorldRepository;
}
