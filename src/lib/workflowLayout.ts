// Pure layout helpers for the Venue Workflows node-graph canvas
// (src/components/WorkflowCanvas.tsx). No React/DOM dependency so this
// can be unit-tested and reused verbatim by the "Auto-arrange" button and
// by the un-connected-node warning in the node detail panel.
import type { WFNode, WFEdge } from "../components/WorkflowCanvas";

const CANVAS_W = 900;
const NODE_W = 180;
const ROW_H = 110;
const TOP_PAD = 30;

/** BFS depth from the trigger node, following edges source -> target. Nodes
 * unreachable from the trigger (including the trigger itself if somehow
 * missing) get depth -1 and are laid out in a separate row below the graph. */
function computeDepths(nodes: WFNode[], edges: WFEdge[]): Map<string, number> {
  const depths = new Map<string, number>();
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return depths;
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }
  depths.set(trigger.id, 0);
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.shift()!;
    const depth = depths.get(id)!;
    for (const childId of childrenOf.get(id) || []) {
      if (!depths.has(childId)) {
        depths.set(childId, depth + 1);
        queue.push(childId);
      }
    }
  }
  return depths;
}

/** Returns the ids of nodes not reachable from the trigger by following
 * edges forward. Used both by layoutGraph (to bucket them into an
 * "unconnected" row) and by the editor UI (to show a non-blocking warning
 * that a node currently does nothing). */
export function unreachableNodeIds(nodes: WFNode[], edges: WFEdge[]): string[] {
  const depths = computeDepths(nodes, edges);
  return nodes.filter((n) => !depths.has(n.id)).map((n) => n.id);
}

/** Layered/BFS-depth auto-layout: trigger at depth 0, each subsequent node's
 * depth is the shortest path length from the trigger via edges. Nodes not
 * reachable from the trigger are placed in a separate row below the rest of
 * the graph — never hidden, never mixed in with the live flow. Within a
 * row, nodes are distributed evenly across the 900px logical canvas width in
 * their existing left-to-right order, so re-running doesn't shuffle
 * manually-arranged nodes within the same row. */
export function layoutGraph(nodes: WFNode[], edges: WFEdge[]): WFNode[] {
  if (!nodes.length) return nodes;
  const depths = computeDepths(nodes, edges);
  const rows = new Map<number, WFNode[]>();
  const UNCONNECTED_ROW = -1;
  for (const n of nodes) {
    const depth = depths.has(n.id) ? depths.get(n.id)! : UNCONNECTED_ROW;
    if (!rows.has(depth)) rows.set(depth, []);
    rows.get(depth)!.push(n);
  }
  // Preserve existing left-to-right order within each row.
  for (const row of rows.values()) row.sort((a, b) => a.x - b.x);

  const connectedDepths = [...rows.keys()].filter((d) => d !== UNCONNECTED_ROW).sort((a, b) => a - b);
  const rowOrder = [...connectedDepths, ...(rows.has(UNCONNECTED_ROW) ? [UNCONNECTED_ROW] : [])];

  const positioned = new Map<string, { x: number; y: number }>();
  rowOrder.forEach((depth, rowIndex) => {
    const rowNodes = rows.get(depth)!;
    const count = rowNodes.length;
    const slotW = CANVAS_W / count;
    const y = TOP_PAD + rowIndex * ROW_H;
    rowNodes.forEach((n, i) => {
      const x = Math.max(0, Math.min(CANVAS_W - NODE_W, slotW * i + (slotW - NODE_W) / 2));
      positioned.set(n.id, { x: Math.round(x), y });
    });
  });

  return nodes.map((n) => {
    const p = positioned.get(n.id);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}
