import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeWorldDetail } from "@echoo/shared";
import { fogHarborLettersFixture, spaceStationNavigatorFixture } from "@echoo/shared";
import {
  compilePrimeWorld,
  PrimeWorldCompileError,
  validatePrimeWorldDefinition,
} from "./prime-world-compiler.js";

const base: PrimeWorldDetail = {
  schemaVersion: 1,
  definitionRevision: 1,
  initialState: {},
  presentation: {
    theme: "dark",
    startView: {
      revision: 0,
      root: { id: "root", type: "stack", children: [] },
    },
  },
  workflow: {
    version: 1,
    editor: { positions: {} },
    nodes: [
      { id: "start", type: "trigger.worldStart", version: 1, config: {} },
      {
        id: "view",
        type: "view.render",
        version: 1,
        config: {
          view: {
            revision: 0,
            root: { id: "root", type: "stack", children: [] },
          },
        },
      },
    ],
    edges: [
      {
        id: "start-view",
        kind: "control",
        source: { nodeId: "start", port: "control" },
        target: { nodeId: "view", port: "control" },
      },
    ],
  },
};

test("compiles a valid control workflow", () => {
  const compiled = compilePrimeWorld(base);
  assert.equal(compiled.nodes.size, 2);
  assert.equal(compiled.outgoing.get("start:control")?.length, 1);
});

test("rejects a control cycle", () => {
  const detail = structuredClone(base);
  detail.workflow.edges.push({
    id: "view-start",
    kind: "control",
    source: { nodeId: "view", port: "control" },
    target: { nodeId: "start", port: "control" },
  });
  assert.throws(() => compilePrimeWorld(detail), PrimeWorldCompileError);
});

test("rejects incompatible data edge ports", () => {
  const detail = structuredClone(base);
  detail.workflow.edges.push({
    id: "wrong",
    kind: "data",
    source: { nodeId: "start", port: "event" },
    target: { nodeId: "view", port: "control" },
  });
  assert.throws(() => compilePrimeWorld(detail), PrimeWorldCompileError);
});

test("returns a node-level issue for an unknown port", () => {
  const detail = structuredClone(base);
  detail.workflow.edges[0]!.source.port = "missing";
  assert.throws(
    () => compilePrimeWorld(detail),
    (error: unknown) => {
      assert.ok(error instanceof PrimeWorldCompileError);
      assert.equal(error.code, "UNKNOWN_PORT");
      assert.equal(error.nodeId, "start");
      return true;
    },
  );
});

test("compiles the built-in M2 and M3 world fixtures", () => {
  assert.doesNotThrow(() => compilePrimeWorld(fogHarborLettersFixture));
  assert.doesNotThrow(() => compilePrimeWorld(spaceStationNavigatorFixture));
});

test("rejects an initial state outside the safe state schema", () => {
  const detail = structuredClone(base);
  detail.initialState = { turn: "wrong" };
  detail.stateSchema = {
    type: "object",
    properties: { turn: { type: "integer" } },
    required: ["turn"],
    additionalProperties: false,
  };
  assert.throws(
    () => compilePrimeWorld(detail),
    (error: unknown) => error instanceof PrimeWorldCompileError && error.code === "INVALID_STATE_SCHEMA",
  );
});

test("rejects a stream source without a sink", () => {
  const detail = structuredClone(base);
  detail.workflow.nodes.push(
    { id: "text", type: "trigger.textInput", version: 1, config: {} },
    { id: "stream", type: "convert.textToStream", version: 1, config: {} },
  );
  detail.workflow.edges.push(
    { id: "text-stream-control", kind: "control", source: { nodeId: "text", port: "control" }, target: { nodeId: "stream", port: "control" } },
    { id: "text-stream-data", kind: "data", source: { nodeId: "text", port: "text" }, target: { nodeId: "stream", port: "text" } },
  );
  const issues = validatePrimeWorldDefinition(detail);
  assert.ok(issues.some((issue) => issue.code === "STREAM_WITHOUT_SINK"));
});

test("requires explicit audio stream collection before batch STT", () => {
  const detail = structuredClone(base);
  detail.workflow.nodes.push(
    { id: "voice", type: "trigger.voiceInput", version: 1, config: {} },
    { id: "to-stream", type: "convert.audioToStream", version: 1, config: {} },
    { id: "stt", type: "audio.stt", version: 1, config: {} },
  );
  detail.workflow.edges.push(
    { id: "voice-stream-control", kind: "control", source: { nodeId: "voice", port: "control" }, target: { nodeId: "to-stream", port: "control" } },
    { id: "stream-stt-control", kind: "control", source: { nodeId: "to-stream", port: "control" }, target: { nodeId: "stt", port: "control" } },
    { id: "voice-audio", kind: "data", source: { nodeId: "voice", port: "audio" }, target: { nodeId: "to-stream", port: "audio" } },
    { id: "stream-audio", kind: "data", source: { nodeId: "to-stream", port: "audioStream" }, target: { nodeId: "stt", port: "audio" } },
  );
  assert.throws(
    () => compilePrimeWorld(detail),
    (error: unknown) => error instanceof PrimeWorldCompileError && error.code === "PORT_TYPE_MISMATCH",
  );
});

test("rejects conflicting writes in parallel fork branches", () => {
  const detail = structuredClone(base);
  detail.workflow.nodes = [
    { id: "start", type: "trigger.worldStart", version: 1, config: {} },
    { id: "fork", type: "flow.fork", version: 1, config: {} },
    { id: "left", type: "state.set", version: 1, config: { path: "/score", value: 1 } },
    { id: "right", type: "state.set", version: 1, config: { path: "/score", value: 2 } },
  ];
  detail.workflow.edges = [
    { id: "start-fork", kind: "control", source: { nodeId: "start", port: "control" }, target: { nodeId: "fork", port: "control" } },
    { id: "fork-left", kind: "control", source: { nodeId: "fork", port: "branchLeft" }, target: { nodeId: "left", port: "control" } },
    { id: "fork-right", kind: "control", source: { nodeId: "fork", port: "branchRight" }, target: { nodeId: "right", port: "control" } },
  ];
  assert.throws(
    () => compilePrimeWorld(detail),
    (error: unknown) => error instanceof PrimeWorldCompileError && error.code === "PARALLEL_WRITE_CONFLICT",
  );
});
