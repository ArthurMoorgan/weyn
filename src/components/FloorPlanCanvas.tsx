import { useRef, useState } from "react";
import type { FloorTable } from "../api";

// Shared floor-plan canvas — used three ways:
//   "edit"   — owner drags/resizes tables to lay out the room (venue Tables
//              tab, event Seating tab)
//   "assign" — owner clicks an available table to assign it to a
//              reservation/booking (read-only positions)
//   "pick"   — guest clicks seats/tables to select them before checkout
// One component instead of three near-duplicates, since the only real
// difference between modes is which interactions are enabled, not the
// rendering itself.
export type CanvasMode = "edit" | "assign" | "pick";

const CANVAS_W = 720;
const CANVAS_H = 480;

const STATUS_COLOR: Record<string, string> = {
  available: "var(--surface-2)",
  reserved: "#e6a23c",
  occupied: "#d94f4f",
  needs_cleaning: "#8a8a8a",
  maintenance: "#5b5b5b",
};

export default function FloorPlanCanvas({
  tables, mode, seatMode = false, selectedTableIds = [], selectedSeatIds = [],
  onTableClick, onSeatClick, onTableDrag, onTableResize,
}: {
  tables: FloorTable[];
  mode: CanvasMode;
  seatMode?: boolean;
  selectedTableIds?: string[];
  selectedSeatIds?: string[];
  onTableClick?: (table: FloorTable) => void;
  onSeatClick?: (seatId: string, table: FloorTable) => void;
  onTableDrag?: (tableId: string, x: number, y: number) => void;
  onTableResize?: (tableId: string, width: number, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });

  function toCanvasPoint(clientX: number, clientY: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDrag(e: React.PointerEvent, t: FloorTable) {
    if (mode !== "edit") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e.clientX, e.clientY);
    dragOffset.current = { x: p.x - t.x, y: p.y - t.y };
    setDragId(t.id);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragId && onTableDrag) {
      const p = toCanvasPoint(e.clientX, e.clientY);
      const x = Math.max(0, Math.min(CANVAS_W - 40, p.x - dragOffset.current.x));
      const y = Math.max(0, Math.min(CANVAS_H - 40, p.y - dragOffset.current.y));
      onTableDrag(dragId, Math.round(x), Math.round(y));
    }
    if (resizeId && onTableResize) {
      const p = toCanvasPoint(e.clientX, e.clientY);
      const width = Math.max(40, resizeStart.current.width + (p.x - resizeStart.current.x));
      const height = Math.max(40, resizeStart.current.height + (p.y - resizeStart.current.y));
      onTableResize(resizeId, Math.round(width), Math.round(height));
    }
  }

  function endDrag() {
    setDragId(null);
    setResizeId(null);
  }

  function startResize(e: React.PointerEvent, t: FloorTable) {
    if (mode !== "edit") return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e.clientX, e.clientY);
    resizeStart.current = { x: p.x, y: p.y, width: t.width, height: t.height };
    setResizeId(t.id);
  }

  return (
    <div
      ref={ref}
      className="floor-canvas"
      style={{ width: "100%", maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, position: "relative", background: "var(--surface-1)", border: "1px solid var(--glass-line)", borderRadius: 12, overflow: "hidden" }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      {tables.map((t) => {
        const isSelected = selectedTableIds.includes(t.id);
        const clickable = (mode === "assign" && t.status === "available") || (mode === "pick" && !seatMode);
        return (
          <div
            key={t.id}
            onPointerDown={(e) => startDrag(e, t)}
            onClick={() => clickable && onTableClick?.(t)}
            className="floor-table"
            style={{
              position: "absolute", left: t.x, top: t.y, width: t.width, height: t.height,
              transform: `rotate(${t.rotation}deg)`,
              borderRadius: t.shape === "circle" ? "50%" : 8,
              background: isSelected ? "var(--accent)" : STATUS_COLOR[t.status] || "var(--surface-2)",
              border: "1px solid var(--glass-line)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              cursor: mode === "edit" ? "grab" : clickable ? "pointer" : "default",
              userSelect: "none", touchAction: "none",
              fontSize: 11, color: isSelected ? "#fff" : "var(--text)", fontWeight: 600,
              opacity: mode !== "edit" && t.status !== "available" && mode !== "assign" ? 0.7 : 1,
            }}
          >
            <span>{t.label}</span>
            <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>{t.minCapacity}-{t.maxCapacity}</span>
            {seatMode && t.seats.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", marginTop: 2, maxWidth: t.width - 8 }}>
                {t.seats.map((s) => {
                  const seatSelected = selectedSeatIds.includes(s.id);
                  const seatClickable = mode === "pick" && s.status === "available";
                  return (
                    <span
                      key={s.id}
                      onClick={(e) => { e.stopPropagation(); if (seatClickable) onSeatClick?.(s.id, t); }}
                      style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: seatSelected ? "#fff" : s.status === "available" ? "var(--accent)" : "var(--text-3)",
                        border: seatSelected ? "2px solid var(--accent)" : "none",
                        cursor: seatClickable ? "pointer" : "default",
                      }}
                      title={s.label || `Seat ${s.index}`}
                    />
                  );
                })}
              </div>
            )}
            {mode === "edit" && (
              <div
                onPointerDown={(e) => startResize(e, t)}
                style={{ position: "absolute", right: -4, bottom: -4, width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", cursor: "nwse-resize", border: "2px solid var(--surface-1)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
