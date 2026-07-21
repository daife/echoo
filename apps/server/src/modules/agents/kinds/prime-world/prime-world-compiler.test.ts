import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeWorldDetail } from "@echoo/shared";
import {
  compilePrimeWorld,
  PrimeWorldCompileError,
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
