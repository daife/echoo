import type { EdgeChange, NodeChange } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRIME_WORLD_DETAIL } from "./primeWorldTemplate";
import {
  applyPersistentEdgeChanges,
  applyPersistentNodeChanges,
  paletteNodePosition,
} from "./primeWorldGraphChanges";

describe("Prime World graph persistence", () => {
  let detail: typeof DEFAULT_PRIME_WORLD_DETAIL;

  beforeEach(() => {
    detail = structuredClone(DEFAULT_PRIME_WORLD_DETAIL);
  });

  it("ignores React Flow measurement and selection changes", () => {
    const before = structuredClone(detail);
    const changes: NodeChange[] = [
      {
        id: "start",
        type: "dimensions",
        dimensions: { width: 200, height: 100 },
      },
      { id: "start", type: "select", selected: true },
    ];

    expect(applyPersistentNodeChanges(detail, changes)).toBe(false);
    expect(detail).toEqual(before);
  });

  it("persists node positions", () => {
    expect(
      applyPersistentNodeChanges(detail, [
        { id: "start", type: "position", position: { x: 320, y: 180 } },
      ]),
    ).toBe(true);
    expect(detail.workflow.editor.positions.start).toEqual({ x: 320, y: 180 });
  });

  it("removes a node together with its position and incident edges", () => {
    expect(
      applyPersistentNodeChanges(detail, [{ id: "start", type: "remove" }]),
    ).toBe(true);
    expect(detail.workflow.nodes.some((node) => node.id === "start")).toBe(
      false,
    );
    expect(detail.workflow.editor.positions.start).toBeUndefined();
    expect(
      detail.workflow.edges.some(
        (edge) =>
          edge.source.nodeId === "start" || edge.target.nodeId === "start",
      ),
    ).toBe(false);
  });

  it("only persists edge removals", () => {
    const edgeId = detail.workflow.edges[0]!.id;
    const selection: EdgeChange[] = [
      { id: edgeId, type: "select", selected: true },
    ];
    expect(applyPersistentEdgeChanges(detail, selection)).toBe(false);
    expect(detail.workflow.edges.some((edge) => edge.id === edgeId)).toBe(true);

    expect(
      applyPersistentEdgeChanges(detail, [{ id: edgeId, type: "remove" }]),
    ).toBe(true);
    expect(detail.workflow.edges.some((edge) => edge.id === edgeId)).toBe(
      false,
    );
  });

  it("starts from a complete LLM story workflow", () => {
    const nodeTypes = new Set(detail.workflow.nodes.map((node) => node.type));

    expect([...nodeTypes]).toEqual(
      expect.arrayContaining([
        "trigger.textInput",
        "trigger.uiAction",
        "history.read",
        "data.messages",
        "ai.llm",
        "state.patch",
        "view.showChoices",
      ]),
    );
    expect(
      detail.workflow.nodes.every(
        (node) => detail.workflow.editor.positions[node.id] !== undefined,
      ),
    ).toBe(true);
  });

  it("places palette nodes near the viewport center with a cascade", () => {
    const bounds = { left: 100, top: 50, width: 800, height: 600 };
    const convert = ({ x, y }: { x: number; y: number }) => ({
      x: x / 2,
      y: y / 2,
    });

    expect(paletteNodePosition(bounds, convert, 0)).toEqual({ x: 154, y: 135 });
    expect(paletteNodePosition(bounds, convert, 1)).toEqual({ x: 178, y: 159 });
  });
});
