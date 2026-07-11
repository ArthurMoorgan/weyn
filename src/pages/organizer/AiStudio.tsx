import { useEffect, useState } from "react";
import { api, isPast, type Weyn, type AgentTurn, type AgentAction } from "../../api";
import { useAsync } from "../../hooks";
import FeatureLock from "../../components/FeatureLock";

// Gemini-powered tools (server/ai.js auto-picks whichever provider key is
// configured — Gemini preferred). Every output lands here for the organizer
// to review/edit/copy/download — nothing generated here ever gets
// auto-published or auto-set as an event's live cover. Cover art concepts
// generate a real image now (Gemini-only, see ai.js's generateImage); an
// auto-FAQ chatbot and predictive attendance forecasting from the original
// plan are deliberately not built yet — flagged honestly rather than faked.
export default function AiStudio() {
  const events = useAsync(() => api.dashboardEvents(), []);
  const sub = useAsync(() => api.mySubscription(), []);
  const [eventId, setEventId] = useState<string>("");
  const enabled = !!sub.data?.features.aiStudio;

  const list = events.data || [];
  const selected = list.find((e) => e.id === eventId) || list[0] || null;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 14px" }}>Generate a description, cover-art concept, pricing suggestion, or post-event summary for any of your events. Always editable — nothing here publishes itself.</p>

      {events.loading && <p className="hint">Loading…</p>}
      {!events.loading && list.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>Host an event first, then come back here.</p>}
      {list.length > 0 && (
        <div className="field">
          <label>Event</label>
          <select value={selected?.id || ""} onChange={(e) => setEventId(e.target.value)}>
            {list.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>
      )}

      <FeatureLock feature="aiStudio" enabled={enabled}>
        <InsightsTool />
        <AgentTool />
        <AssistantTool />
      </FeatureLock>

      {selected && (
        <FeatureLock feature="aiStudio" enabled={enabled}>
          <DescriptionTool event={selected} />
          <CoverConceptTool event={selected} />
          <PricingTool event={selected} />
          {isPast(selected) && <SummaryTool event={selected} />}
        </FeatureLock>
      )}
    </>
  );
}

function InsightsTool() {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setBusy(true); setErr("");
    try {
      setResult((await api.aiInsights()).insights);
    } catch (e: any) {
      setErr(e.message || "Couldn't generate insights");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolCard title="Insights report" icon="lightbulb">
      <p className="hint" style={{ margin: "0 0 10px" }}>A written summary of what's working across all your events, based on your real revenue and sales numbers.</p>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={generate} disabled={busy}>{busy ? "Analyzing…" : "Generate report"}</button>
      {result && (
        <div className="marketing-card" style={{ marginTop: 12 }}><pre className="marketing-text">{result}</pre></div>
      )}
    </ToolCard>
  );
}

// Phase 1 of the agentic assistant — real tools (see server/agent-tools.js)
// instead of a fixed context blob. Read-only lookups (revenue, reservations,
// customer history, table availability) answer inline; anything that would
// create/send/cancel something comes back as a card the owner has to
// explicitly approve or reject — never executed silently. `geminiHistory` is
// Gemini's own {role, parts} turn shape, replayed verbatim each turn so
// tool-call/tool-result turns stay coherent; `log` is a separate
// display-only transcript (tool-call turns never render as chat bubbles).
function AgentTool() {
  const [log, setLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [geminiHistory, setGeminiHistory] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pendingQuery = useAsync(() => api.listAgentActions("proposed"), []);
  const [pending, setPending] = useState<AgentAction[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => { if (pendingQuery.data) setPending(pendingQuery.data); }, [pendingQuery.data]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput(""); setErr("");
    setLog((prev) => [...prev, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await api.aiAgentChat(message, geminiHistory);
      setGeminiHistory(res.history);
      setLog((prev) => [...prev, { role: "assistant", text: res.reply }]);
      if (res.proposedActions.length) setPending((prev) => [...res.proposedActions, ...prev]);
    } catch (e: any) {
      setErr(e.message || "Couldn't reply right now");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setDecidingId(id);
    try {
      const updated = approve ? await api.approveAgentAction(id) : await api.rejectAgentAction(id);
      setPending((prev) => prev.map((a) => (a.id === id ? updated : a)).filter((a) => a.status === "proposed"));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <ToolCard title="Weyn AI" icon="sparkles">
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Ask it to look something up or propose an action — anything that creates, sends, or cancels something waits for your approval below before it actually happens.
      </p>

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {pending.map((a) => (
            <div key={a.id} className="marketing-card" style={{ border: "1px solid var(--glass-line)" }}>
              <b style={{ fontSize: 13 }}>{a.tool}</b>
              <p style={{ fontSize: 13, margin: "4px 0", color: "var(--text-2)" }}>{a.reasoning}</p>
              <pre style={{ fontSize: 11.5, background: "var(--surface-2)", padding: 8, borderRadius: 6, overflowX: "auto", margin: "0 0 8px" }}>
                {JSON.stringify(Object.fromEntries(Object.entries(a.args).filter(([k]) => k !== "reasoning")), null, 2)}
              </pre>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn glass sm" style={{ width: "auto" }} onClick={() => decide(a.id, true)} disabled={decidingId === a.id}>
                  <i className="icon-check" /> Approve
                </button>
                <button className="btn glass sm" style={{ width: "auto" }} onClick={() => decide(a.id, false)} disabled={decidingId === a.id}>
                  <i className="icon-x" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {log.map((h, i) => (
            <div key={i} className="marketing-card" style={{ background: h.role === "user" ? "var(--card-alt, rgba(0,0,0,0.03))" : undefined }}>
              <p style={{ fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}><b>{h.role === "user" ? "You" : "Weyn AI"}:</b> {h.text}</p>
            </div>
          ))}
        </div>
      )}
      {err && <p className="errline">{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="How's Friday looking? Assign a table for..." style={{ flex: 1 }} />
        <button className="btn" onClick={send} disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</button>
      </div>
    </ToolCard>
  );
}

function AssistantTool() {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput(""); setErr("");
    const nextHistory = [...history, { role: "user" as const, content: message }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      const res = await api.aiAssistant(message, history);
      setHistory([...nextHistory, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      setErr(e.message || "Couldn't reply right now");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolCard title="AI Assistant" icon="message-circle">
      <p className="hint" style={{ margin: "0 0 10px" }}>Ask about your events — grounded in your real dashboard numbers, not a generic chatbot.</p>
      {history.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {history.map((h, i) => (
            <div key={i} className="marketing-card" style={{ background: h.role === "user" ? "var(--card-alt, rgba(0,0,0,0.03))" : undefined }}>
              <p style={{ fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}><b>{h.role === "user" ? "You" : "Assistant"}:</b> {h.content}</p>
            </div>
          ))}
        </div>
      )}
      {err && <p className="errline">{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="How's my next event looking?" style={{ flex: 1 }} />
        <button className="btn" onClick={send} disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</button>
      </div>
    </ToolCard>
  );
}

function ToolCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <>
      <div className="date-head"><h2><i className={`icon-${icon}`} style={{ marginRight: 6 }} />{title}</h2></div>
      <div className="dash-card" style={{ padding: 16, marginBottom: 16 }}>{children}</div>
    </>
  );
}

function DescriptionTool({ event }: { event: Weyn }) {
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!notes.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await api.aiDescription(event.id, notes);
      setResult(res.description);
    } catch (e: any) {
      setErr(e.message || "Couldn't generate a description");
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    navigator.clipboard?.writeText(result).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <ToolCard title="Description generator" icon="file-text">
      <div className="field"><label>Notes / bullet points</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Live DJ set, rooftop venue, 21+, free welcome drink…" /></div>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={generate} disabled={busy || !notes.trim()}>{busy ? "Generating…" : "Generate"}</button>
      {result && (
        <div className="marketing-card" style={{ marginTop: 12 }}>
          <div className="marketing-card-head">
            <b>Description</b>
            <button className="copy-btn" onClick={copy}><i className={copied ? "icon-check" : "icon-copy"} /> {copied ? "Copied" : "Copy"}</button>
          </div>
          <pre className="marketing-text">{result}</pre>
        </div>
      )}
    </ToolCard>
  );
}

function CoverConceptTool({ event }: { event: Weyn }) {
  const [concepts, setConcepts] = useState<{ name: string; description: string; palette: string[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [images, setImages] = useState<Record<number, string>>({});
  const [imageBusy, setImageBusy] = useState<number | null>(null);
  const [imageErr, setImageErr] = useState<Record<number, string>>({});

  async function generate() {
    setBusy(true); setErr(""); setImages({}); setImageErr({});
    try {
      const res = await api.aiCoverConcept(event.id);
      setConcepts(res.concepts);
    } catch (e: any) {
      setErr(e.message || "Couldn't generate concepts");
    } finally {
      setBusy(false);
    }
  }

  async function generateImage(i: number, description: string) {
    setImageBusy(i);
    setImageErr((prev) => ({ ...prev, [i]: "" }));
    try {
      const { url } = await api.aiCoverImage(event.id, description);
      setImages((prev) => ({ ...prev, [i]: url }));
    } catch (e: any) {
      setImageErr((prev) => ({ ...prev, [i]: e.message || "Couldn't generate an image" }));
    } finally {
      setImageBusy(null);
    }
  }

  return (
    <ToolCard title="Cover art concepts" icon="palette">
      <p className="hint" style={{ margin: "0 0 10px" }}>Pick a visual direction, then generate a real cover image from it — always a preview to download, never auto-set as your event's live cover.</p>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate concepts"}</button>
      {concepts && concepts.map((c, i) => (
        <div key={i} className="marketing-card" style={{ marginTop: 12 }}>
          <div className="marketing-card-head"><b>{c.name}</b></div>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 8px" }}>{c.description}</p>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {c.palette.map((hex, j) => (
              <div key={j} title={hex} style={{ width: 28, height: 28, borderRadius: 6, background: hex, border: "1px solid var(--border)" }} />
            ))}
          </div>
          {imageErr[i] && <p className="errline">{imageErr[i]}</p>}
          {images[i] ? (
            <>
              <img src={images[i]} alt={`Generated cover for "${c.name}"`} style={{ width: "100%", borderRadius: 10, marginBottom: 8, display: "block" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <a href={images[i]} download className="btn glass sm"><i className="icon-download" /> Download</a>
                <button className="btn glass sm" onClick={() => generateImage(i, c.description)} disabled={imageBusy === i}>
                  {imageBusy === i ? "Regenerating…" : "Regenerate"}
                </button>
              </div>
            </>
          ) : (
            <button className="btn glass sm" onClick={() => generateImage(i, c.description)} disabled={imageBusy === i}>
              <i className="icon-image" /> {imageBusy === i ? "Generating image…" : "Generate image"}
            </button>
          )}
        </div>
      ))}
    </ToolCard>
  );
}

function PricingTool({ event }: { event: Weyn }) {
  const [result, setResult] = useState<{ suggestedPrice: number | null; reasoning: string; sampleSize: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setBusy(true); setErr("");
    try {
      setResult(await api.aiPricingSuggestion(event.id));
    } catch (e: any) {
      setErr(e.message || "Couldn't generate a suggestion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolCard title="Smart pricing suggestion" icon="tag">
      <p className="hint" style={{ margin: "0 0 10px" }}>Based on similar past events on Weyn ({event.cat}, comparable capacity) that actually sold tickets.</p>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={generate} disabled={busy}>{busy ? "Analyzing…" : "Suggest a price"}</button>
      {result && (
        <div className="marketing-card" style={{ marginTop: 12 }}>
          {result.suggestedPrice !== null ? (
            <div className="marketing-card-head"><b>{result.suggestedPrice} OMR</b><small style={{ color: "var(--text-3)" }}>· based on {result.sampleSize} similar events</small></div>
          ) : null}
          <p style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 6 }}>{result.reasoning}</p>
        </div>
      )}
    </ToolCard>
  );
}

function SummaryTool({ event }: { event: Weyn }) {
  const [result, setResult] = useState<{ summary: string; stats: { ticketsSold: number; capacity: number; revenue: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setBusy(true); setErr("");
    try {
      setResult(await api.aiEventSummary(event.id));
    } catch (e: any) {
      setErr(e.message || "Couldn't generate a summary");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolCard title="Post-event summary" icon="clipboard-check">
      <p className="hint" style={{ margin: "0 0 10px" }}>A quick honest recap once an event's finished — real numbers, not generic praise.</p>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={generate} disabled={busy}>{busy ? "Analyzing…" : "Generate summary"}</button>
      {result && (
        <div className="marketing-card" style={{ marginTop: 12 }}>
          <pre className="marketing-text">{result.summary}</pre>
        </div>
      )}
    </ToolCard>
  );
}
