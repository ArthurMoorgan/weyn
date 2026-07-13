import { useState } from "react";
import { api, type EventWorkflow, type EventWorkflowTrigger, type EventConditionField, type EventWorkflowAction, type EventWorkflowRun, type WFNode, type WFEdge, type WFNodeType, type Weyn } from "../../api";
import { useAsync } from "../../hooks";
import WorkflowCanvas from "../../components/WorkflowCanvas";

// Organizer dashboard's node-graph automation builder — full parity with
// the venue side's Workflows tab (src/pages/venue-os/Workspace.tsx's
// VenueWorkflows/WorkflowEditor/WorkflowRunsPanel), against the
// event/ticketing catalog in server/event-workflows.js instead of
// reservations/guests. Cross-event (a top-level nav tab, not nested inside
// a single event's workspace) because several actions here (notify_team,
// send_campaign) are portfolio-wide in spirit and organizers running
// multiple events want one place to see automations across all of them —
// same reasoning as Overview/Attendees being cross-event. Since
// EventWorkflow.eventId is required, creating a new workflow needs an event
// picker first (see EventPicker below).
const TRIGGER_LABELS: Record<EventWorkflowTrigger, string> = {
  ticket_sold: "Ticket sold",
  low_inventory: "Inventory running low",
  event_published: "Event published",
  waitlist_joined: "Someone joins the waitlist",
  promo_code_used: "Promo code used",
};
const CONDITION_FIELD_LABELS: Record<EventConditionField, string> = {
  ticketTier: "Ticket tier",
  quantityRemaining: "Quantity remaining",
  attendeeEmailDomain: "Attendee email domain",
};
const ACTION_LABELS: Record<EventWorkflowAction, string> = {
  notify_team: "Notify my team (email)",
  send_campaign: "Send a campaign to attendees",
  apply_promo_code: "Apply / extend a promo code",
  add_to_waitlist_priority: "Bump waitlist priority",
};

let wfNodeCounter = 0;
function newNodeId() { wfNodeCounter += 1; return `node-${Date.now()}-${wfNodeCounter}`; }

function defaultDataFor(type: WFNodeType): Record<string, any> {
  if (type === "trigger") return { trigger: "ticket_sold" };
  if (type === "condition") return { field: "quantityRemaining", op: "<=", value: "" };
  return { action: "notify_team", config: {} };
}

function nodeLabel(n: WFNode): { title: string; subtitle: string } {
  if (n.type === "trigger") return { title: TRIGGER_LABELS[n.data.trigger as EventWorkflowTrigger] || n.data.trigger, subtitle: "Trigger" };
  if (n.type === "condition") {
    const field = CONDITION_FIELD_LABELS[n.data.field as EventConditionField] || n.data.field;
    return { title: `${field} ${n.data.op} ${n.data.value}`, subtitle: "Condition" };
  }
  const cfg = n.data.config || {};
  const subtitle = n.data.action === "apply_promo_code" ? (cfg.code || "no code set")
    : n.data.action === "add_to_waitlist_priority" ? `priority ${cfg.priority ?? 1}`
    : (cfg.subject || "no subject set");
  return { title: ACTION_LABELS[n.data.action as EventWorkflowAction] || n.data.action, subtitle };
}

export default function Workflows() {
  const { data: workflows, loading, reload } = useAsync(() => api.organizerWorkflows(), []);
  const events = useAsync(() => api.dashboardEvents(), []);
  const [editing, setEditing] = useState<EventWorkflow | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const eventTitle = (eventId: string) => events.data?.find((e) => e.id === eventId)?.title || "Unknown event";

  async function createFor(eventId: string) {
    setCreating(true);
    try {
      const trigger: WFNode = { id: newNodeId(), type: "trigger", x: 30, y: 180, data: defaultDataFor("trigger") };
      const wf = await api.createEventWorkflow(eventId, { name: "New workflow", nodes: [trigger], edges: [] });
      setPicking(false);
      reload();
      setEditing(wf);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(wf: EventWorkflow) {
    await api.setEventWorkflowEnabled(wf.eventId, wf.id, !wf.enabled);
    reload();
  }

  async function remove(wf: EventWorkflow) {
    await api.deleteEventWorkflow(wf.eventId, wf.id);
    reload();
  }

  if (editing) {
    return <WorkflowEditor workflow={editing} eventTitle={eventTitle(editing.eventId)} onDone={() => { setEditing(null); reload(); }} />;
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-zap" /> Workflows</span>
        <button type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setPicking(true)} disabled={creating || events.loading}>
          <i className="icon-plus" /> New workflow
        </button>
      </p>
      <p className="hint" style={{ margin: "0 0 14px", color: "var(--text-3)" }}>
        Trigger → condition → action, evaluated the instant a ticket sells, an event publishes, or someone joins a waitlist — across every event you run.
      </p>

      {picking && (
        <EventPicker
          events={events.data || []}
          onPick={createFor}
          onCancel={() => setPicking(false)}
        />
      )}

      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !workflows?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No workflows yet — create one above.</p>
      ) : (
        <ul className="steps">
          {workflows.map((w) => {
            const trigger = w.nodes.find((n) => n.type === "trigger");
            const actionCount = w.nodes.filter((n) => n.type === "action").length;
            return (
              <li key={w.id}>
                <i className="icon-zap" />
                <span>
                  {w.name} <span className={"ec-badge " + (w.enabled ? "confirmed" : "")}>{w.enabled ? "on" : "off"}</span>
                  <br />
                  <small style={{ color: "var(--text-3)" }}>
                    {eventTitle(w.eventId)} · {trigger ? TRIGGER_LABELS[trigger.data.trigger as EventWorkflowTrigger] || trigger.data.trigger : "no trigger"} · {actionCount} action{actionCount === 1 ? "" : "s"}
                  </small>
                </span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button className="btn glass sm" onClick={() => setEditing(w)}>Edit</button>
                  <button className="btn glass sm" onClick={() => toggle(w)}>{w.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn glass sm" onClick={() => remove(w)}><i className="icon-x" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function EventPicker({ events, onPick, onCancel }: { events: Weyn[]; onPick: (eventId: string) => void; onCancel: () => void }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  return (
    <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
      <p className="hint" style={{ margin: "0 0 10px" }}>Which event is this workflow for?</p>
      <div style={{ display: "flex", gap: 8 }}>
        <select className="toolbar-field" style={{ flex: 1 }} value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={onCancel}>Cancel</button>
        <button className="btn sm" style={{ width: "auto" }} disabled={!eventId} onClick={() => onPick(eventId)}>Create</button>
      </div>
    </div>
  );
}

function WorkflowEditor({ workflow, eventTitle, onDone }: { workflow: EventWorkflow; eventTitle: string; onDone: () => void }) {
  const [name, setName] = useState(workflow.name);
  const [nodes, setNodes] = useState<WFNode[]>(workflow.nodes);
  const [edges, setEdges] = useState<WFEdge[]>(workflow.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);

  const selected = nodes.find((n) => n.id === selectedNodeId) || null;
  let nextY = 40 + nodes.length * 90;

  function addNode(type: WFNodeType) {
    const n: WFNode = { id: newNodeId(), type, x: 280 + (nodes.length % 3) * 200, y: nextY % (CANVAS_H_APPROX - 80), data: defaultDataFor(type) };
    setNodes([...nodes, n]);
    setSelectedNodeId(n.id);
    setDirty(true);
  }

  function updateSelectedData(patch: Record<string, any>) {
    if (!selected) return;
    setNodes(nodes.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.type === "trigger") { setErr("A workflow needs its trigger node — delete the whole workflow instead if you don't need this rule."); return; }
    setNodes(nodes.filter((n) => n.id !== selected.id));
    setEdges(edges.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelectedNodeId(null);
    setDirty(true);
  }

  async function save() {
    setSaving(true); setErr("");
    try {
      await api.saveEventWorkflow(workflow.eventId, workflow.id, { name, nodes, edges });
      setDirty(false);
    } catch (e: any) {
      setErr(e.message || "Couldn't save — check every condition/action node is filled in.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={onDone}><i className="icon-arrow-left" /> Back</button>
        <input className="toolbar-field" style={{ flex: 1 }} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <button className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowRuns((v) => !v)}>{showRuns ? "Canvas" : "Run history"}</button>
      </div>
      <p className="hint" style={{ margin: "0 0 10px", color: "var(--text-3)" }}>{eventTitle}</p>

      {showRuns ? (
        <WorkflowRunsPanel eventId={workflow.eventId} workflowId={workflow.id} />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="btn glass sm" style={{ width: "auto" }} onClick={() => addNode("condition")}><i className="icon-plus" /> Condition</button>
            <button className="btn glass sm" style={{ width: "auto" }} onClick={() => addNode("action")}><i className="icon-plus" /> Action</button>
          </div>

          <WorkflowCanvas
            nodes={nodes} edges={edges}
            onNodesChange={(n) => { setNodes(n); setDirty(true); }}
            onEdgesChange={(e) => { setEdges(e); setDirty(true); }}
            onSelectNode={setSelectedNodeId} selectedNodeId={selectedNodeId}
            renderLabel={nodeLabel}
          />

          {selected && (
            <div className="dash-card" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p className="hint" style={{ margin: 0 }}>{selected.type === "trigger" ? "Trigger" : selected.type === "condition" ? "Condition" : "Action"}</p>
                {selected.type !== "trigger" && <button className="btn glass sm" style={{ width: "auto" }} onClick={deleteSelected}><i className="icon-x" /> Remove node</button>}
              </div>

              {selected.type === "trigger" && (
                <>
                  <div className="field" style={{ margin: 0 }}>
                    <label>When</label>
                    <select value={selected.data.trigger} onChange={(e) => updateSelectedData({ trigger: e.target.value })}>
                      {Object.entries(TRIGGER_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  {selected.data.trigger === "low_inventory" && (
                    <div className="field" style={{ margin: "10px 0 0" }}>
                      <label>Fire when this many tickets (or fewer) remain</label>
                      <input
                        inputMode="numeric"
                        value={selected.data.config?.threshold ?? 10}
                        onChange={(e) => updateSelectedData({ config: { ...selected.data.config, threshold: e.target.value } })}
                      />
                    </div>
                  )}
                </>
              )}

              {selected.type === "condition" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Field</label>
                    <select value={selected.data.field} onChange={(e) => updateSelectedData({ field: e.target.value, op: "==" })}>
                      {Object.entries(CONDITION_FIELD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Comparison</label>
                    {selected.data.field === "quantityRemaining" ? (
                      <select value={selected.data.op} onChange={(e) => updateSelectedData({ op: e.target.value })}>
                        <option value="<=">≤</option>
                        <option value=">=">≥</option>
                        <option value="==">=</option>
                      </select>
                    ) : (
                      <select value={selected.data.op} onChange={(e) => updateSelectedData({ op: e.target.value })}>
                        <option value="==">is</option>
                        <option value="not_equals">is not</option>
                      </select>
                    )}
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Value</label>
                    <input
                      value={selected.data.value}
                      onChange={(e) => updateSelectedData({ value: e.target.value })}
                      placeholder={selected.data.field === "attendeeEmailDomain" ? "e.g. gmail.com" : selected.data.field === "ticketTier" ? "e.g. VIP" : "e.g. 5"}
                    />
                  </div>
                </div>
              )}

              {selected.type === "action" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Do</label>
                    <select value={selected.data.action} onChange={(e) => updateSelectedData({ action: e.target.value, config: {} })}>
                      {Object.entries(ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  {selected.data.action === "apply_promo_code" ? (
                    <>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Promo code</label>
                        <input value={selected.data.config?.code || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, code: e.target.value } })} placeholder="e.g. EARLYBIRD" />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Extend expiry by (days, optional)</label>
                        <input inputMode="numeric" value={selected.data.config?.extendDays || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, extendDays: e.target.value } })} />
                      </div>
                    </>
                  ) : selected.data.action === "add_to_waitlist_priority" ? (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Priority</label>
                      <input inputMode="numeric" value={selected.data.config?.priority ?? 1} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, priority: e.target.value } })} />
                    </div>
                  ) : (
                    <>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Subject</label>
                        <input value={selected.data.config?.subject || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, subject: e.target.value } })} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Message</label>
                        <textarea rows={3} value={selected.data.config?.message || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, message: e.target.value } })} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {err && <p className="errline" style={{ marginTop: 10 }}>{err}</p>}
          <button className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save workflow" : "Saved ✓"}
          </button>
        </>
      )}
    </>
  );
}
const CANVAS_H_APPROX = 480;

function WorkflowRunsPanel({ eventId, workflowId }: { eventId: string; workflowId: string }) {
  const { data: runs, loading } = useAsync(() => api.eventWorkflowRuns(eventId, workflowId), [eventId, workflowId]);
  if (loading) return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;
  if (!runs?.length) return <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>This workflow hasn't run yet.</p>;
  return (
    <ul className="steps">
      {runs.map((r: EventWorkflowRun) => (
        <li key={r.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i className="icon-zap" />
            <span style={{ flex: 1 }}>
              {TRIGGER_LABELS[r.trigger as EventWorkflowTrigger] || r.trigger}
              {" "}<span className={"ec-badge " + (r.status === "success" ? "confirmed" : r.status === "failed" ? "out" : "")}>{r.status}</span>
              <br />
              <small style={{ color: "var(--text-3)" }}>{new Date(r.createdAt).toLocaleString()}</small>
            </span>
          </div>
          {r.matchedActions.length > 0 && (
            <div style={{ paddingLeft: 30, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {r.matchedActions.map((m, i) => (
                <small key={i} style={{ color: m.ok ? "var(--text-3)" : "var(--danger)" }}>
                  {ACTION_LABELS[m.action as EventWorkflowAction] || m.action} — {m.ok ? "ok" : m.error || "failed"}
                </small>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
