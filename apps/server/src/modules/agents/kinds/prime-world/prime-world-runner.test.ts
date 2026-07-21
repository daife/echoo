import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeWorldDetail, PrimeWorldRuntimeState } from "@echoo/shared";
import { compilePrimeWorld } from "./prime-world-compiler.js";
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
