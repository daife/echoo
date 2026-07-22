import type { PrimeWorldDetail } from "@echoo/shared";
import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";

type Point = { x: number; y: number };

export function applyPersistentNodeChanges<NodeType extends Node>(
  detail: PrimeWorldDetail,
  changes: NodeChange<NodeType>[],
) {
  let changed = false;
  const removedIds = new Set<string>();

  for (const change of changes) {
    if (change.type === "remove") {
      removedIds.add(change.id);
      continue;
    }
    if (change.type !== "position" || !change.position) continue;

    const previous = detail.workflow.editor.positions[change.id];
    if (
      previous?.x === change.position.x &&
      previous.y === change.position.y
    )
      continue;
    detail.workflow.editor.positions[change.id] = change.position;
    changed = true;
  }

  if (!removedIds.size) return changed;

  const nodeCount = detail.workflow.nodes.length;
  detail.workflow.nodes = detail.workflow.nodes.filter(
    (node) => !removedIds.has(node.id),
  );
  if (detail.workflow.nodes.length !== nodeCount) changed = true;

  const edgeCount = detail.workflow.edges.length;
  detail.workflow.edges = detail.workflow.edges.filter(
    (edge) =>
      !removedIds.has(edge.source.nodeId) &&
      !removedIds.has(edge.target.nodeId),
  );
  if (detail.workflow.edges.length !== edgeCount) changed = true;

  for (const id of removedIds) {
    if (!(id in detail.workflow.editor.positions)) continue;
    delete detail.workflow.editor.positions[id];
    changed = true;
  }

  return changed;
}

export function applyPersistentEdgeChanges<EdgeType extends Edge>(
  detail: PrimeWorldDetail,
  changes: EdgeChange<EdgeType>[],
) {
  const removedIds = new Set(
    changes
      .filter((change) => change.type === "remove")
      .map((change) => change.id),
  );
  if (!removedIds.size) return false;

  const edgeCount = detail.workflow.edges.length;
  detail.workflow.edges = detail.workflow.edges.filter(
    (edge) => !removedIds.has(edge.id),
  );
  return detail.workflow.edges.length !== edgeCount;
}

export function paletteNodePosition(
  bounds: { left: number; top: number; width: number; height: number },
  screenToFlowPosition: (position: Point) => Point,
  cascadeIndex: number,
) {
  const center = screenToFlowPosition({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  });
  const offset = (cascadeIndex % 6) * 24;
  return { x: center.x - 96 + offset, y: center.y - 40 + offset };
}
