import { useLayoutEffect, useRef, useState } from "react";

// Generic node-graph canvas for the Workflows automation builder. Same
// fixed-logical-space + CSS-transform-scale coordinate system as
// FloorPlanCanvas (see that component's comment for why — positioning
// nodes in raw CSS pixels inside a fluid container breaks on any screen
// narrower than the logical width). Connecting two nodes is click-then-
// click (click a node's "Connect" handle, then click a different node)
// rather than drag-a-live-line — simpler to get right, still a real graph
// editor: nodes are draggable for layout, edges render as SVG lines that
// track node positions live.
export type WFNodeType = "trigger" | "condition" | "action";
export type WFNode = { id: string; type: WFNodeType; x: number; y: number; data: Record<string, any> };
export type WFEdge = { id: string; source: string; target: string };

const CANVAS_W = 900;
const CANVAS_H = 480;
const NODE_W = 180;
const NODE_H = 64;

const TYPE_COLOR: Record<WFNodeType, string> = {
  trigger: "var(--accent)",
  condition: "#e6a23c",
  action: "#3f9b5c",
};

export default function WorkflowCanvas({
  nodes, edges, onNodesChange, onEdgesChange, onSelectNode, selectedNodeId, renderLabel,
}: {
  nodes: WFNode[];
  edges: WFEdge[];
  onNodesChange: (nodes: WFNode[]) => void;
  onEdgesChange: (edges: WFEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  selectedNodeId: string | null;
  renderLabel: (node: WFNode) => { title: string; subtitle: string };
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [dragId, setDragId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setScale(el.getBoundingClientRect().width / CANVAS_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function toLogicalPoint(clientX: number, clientY: number) {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect || !scale) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  function startDrag(e: React.PointerEvent, n: WFNode) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLogicalPoint(e.clientX, e.clientY);
    dragOffset.current = { x: p.x - n.x, y: p.y - n.y };
    setDragId(n.id);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId) return;
    const p = toLogicalPoint(e.clientX, e.clientY);
    const x = Math.max(0, Math.min(CANVAS_W - NODE_W, p.x - dragOffset.current.x));
    const y = Math.max(0, Math.min(CANVAS_H - NODE_H, p.y - dragOffset.current.y));
    onNodesChange(nodes.map((n) => (n.id === dragId ? { ...n, x: Math.round(x), y: Math.round(y) } : n)));
  }

  function endDrag() {
    setDragId(null);
  }

  function clickNode(n: WFNode) {
    if (connectingFrom && connectingFrom !== n.id) {
      const id = `e-${connectingFrom}-${n.id}-${Date.now()}`;
      onEdgesChange([...edges, { id, source: connectingFrom, target: n.id }]);
      setConnectingFrom(null);
      return;
    }
    onSelectNode(n.id === selectedNodeId ? null : n.id);
  }

  function removeEdge(id: string) {
    onEdgesChange(edges.filter((e) => e.id !== id));
  }

  const center = (n: WFNode) => ({ x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });

  return (
    <div
      ref={outerRef}
      style={{ width: "100%", maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, position: "relative", background: "var(--surface-1)", border: "1px solid var(--glass-line)", borderRadius: 12, overflow: "hidden" }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <svg width={CANVAS_W} height={CANVAS_H} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
          <defs>
            <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)" />
            </marker>
          </defs>
          {edges.map((e) => {
            const source = nodes.find((n) => n.id === e.source);
            const target = nodes.find((n) => n.id === e.target);
            if (!source || !target) return null;
            const a = center(source), b = center(target);
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text-3)" strokeWidth={2} markerEnd="url(#wf-arrow)" pointerEvents="stroke" onClick={() => removeEdge(e.id)} style={{ cursor: "pointer", pointerEvents: "stroke" }} />;
          })}
        </svg>

        {nodes.map((n) => {
          const { title, subtitle } = renderLabel(n);
          const selected = n.id === selectedNodeId;
          const connecting = n.id === connectingFrom;
          return (
            <div
              key={n.id}
              onPointerDown={(e) => startDrag(e, n)}
              onClick={() => clickNode(n)}
              style={{
                position: "absolute", left: n.x, top: n.y, width: NODE_W, height: NODE_H,
                borderRadius: 10, background: "var(--dash-card, var(--glass-strong))",
                border: `2px solid ${selected || connecting ? TYPE_COLOR[n.type] : "var(--glass-line)"}`,
                padding: "8px 10px", cursor: "grab", userSelect: "none", touchAction: "none",
                display: "flex", flexDirection: "column", justifyContent: "center", gap: 2,
                boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.2))",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: TYPE_COLOR[n.type] }}>{n.type}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
              <span style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setConnectingFrom(connecting ? null : n.id); }}
                style={{
                  position: "absolute", right: -10, bottom: -10, width: 22, height: 22, borderRadius: "50%",
                  background: connecting ? TYPE_COLOR[n.type] : "var(--surface-2)", border: "2px solid var(--surface-1)",
                  color: connecting ? "#fff" : "var(--text-2)", fontSize: 12, cursor: "pointer",
                }}
                title="Connect to another node"
              >→</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
