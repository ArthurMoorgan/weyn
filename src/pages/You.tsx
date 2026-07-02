import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ticketsLeft, isSoldOut, dayLabel, timeLabel, type Weyn } from "../api";
import { useAsync } from "../hooks";
import { getOrganizer, useTickets } from "../store";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";
import InstallPrompt from "../components/InstallPrompt";
import GoogleLoginButton from "../components/GoogleLoginButton";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export default function You() {
  const name = getOrganizer();
  const tickets = useTickets();
  const summary = useAsync(() => api.organizerSummary(name), [name]);
  const allEvents = useAsync(() => api.listEvents(), []);

  if (summary.loading || allEvents.loading) {
    return (<><Header /><div className="spin" /></>);
  }

  // NEVER silently fall through on a failed fetch — show it, don't hide it as an empty state
  if (summary.error || allEvents.error) {
    return (
      <>
        <Header />
        <div className="empty">
          <div className="ic"><i className="ti ti-cloud-off" /></div>
          <p>Couldn't reach the server. {summary.error || allEvents.error}</p>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: -8 }}>
            If you're testing a deployed build, make sure it was built with <code>VITE_API_BASE</code> pointing at your live backend URL.
          </p>
          <button className="btn glass" style={{ maxWidth: 220, margin: "0 auto" }} onClick={() => { summary.reload(); allEvents.reload(); }}>
            Try again
          </button>
        </div>
      </>
    );
  }

  const myTickets = (allEvents.data || []).filter((e) => tickets.includes(e.id));

  return (
    <>
      <Header />

      <div className="page-head">
        <h1>You</h1>
        <p className="sub">Signed in as {name}</p>
      </div>

      <div style={{ padding: "0 16px" }}>
        <GoogleLoginButton />
      </div>

      <TicketsSection tickets={myTickets} />
      <OrganizerSection name={name} summary={summary.data!} reload={summary.reload} />

      <div style={{ padding: "0 16px" }}><InstallPrompt /></div>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand"><span className="en">You</span></div>
      <div className="tb-right"><ThemeToggle /></div>
    </header>
  );
}

/* ---------- My tickets (always shown) ---------- */
function TicketsSection({ tickets }: { tickets: Weyn[] }) {
  return (
    <section>
      <div className="date-head"><h2>My tickets</h2><span>{tickets.length}</span></div>
      {tickets.length > 0 ? (
        <div className="feed" style={{ paddingBottom: 4 }}>{tickets.map((e) => <Stub key={e.id} e={e} />)}</div>
      ) : (
        <div className="empty" style={{ padding: "24px 36px 32px" }}>
          <div className="ic"><i className="ti ti-ticket" /></div>
          <p>No tickets yet. RSVP or grab a ticket and it'll show up here.</p>
          <Link to="/" className="btn" style={{ maxWidth: 220, margin: "0 auto" }}>Find something to do</Link>
        </div>
      )}
    </section>
  );
}

/* ---------- Organizer (always shown — CTA or full dashboard) ---------- */
function OrganizerSection({ name, summary, reload }: { name: string; summary: any; reload: () => void }) {
  const isHost = summary.events.length > 0;
  const [editing, setEditing] = useState<Weyn | null>(null);
  const [attendeesFor, setAttendeesFor] = useState<Weyn | null>(null);
  const [marketingFor, setMarketingFor] = useState<Weyn | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isHost) {
    return (
      <section>
        <div className="date-head"><h2>Organizer</h2></div>
        <div className="host-cta" style={{ margin: "0 16px" }}>
          <div>
            <b>Running an event?</b>
            <span>Publish it free and track sales here.</span>
          </div>
          <Link to="/host" className="btn glass" style={{ width: "auto", padding: "11px 16px" }}><i className="ti ti-plus" /> Host</Link>
        </div>
      </section>
    );
  }

  const s = summary.stats;

  async function cancel(e: Weyn) {
    if (!confirm(`Cancel "${e.title}"? It'll disappear from Explore immediately.`)) return;
    setBusyId(e.id);
    try { await api.cancelEvent(e.id); reload(); } finally { setBusyId(null); }
  }
  async function duplicate(e: Weyn) {
    setBusyId(e.id);
    try { await api.duplicateEvent(e.id); reload(); } finally { setBusyId(null); }
  }

  return (
    <section className="dash">
      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Organizer</h2><span>Performance for {name}</span></div>

      <div className="stat-grid">
        <div className="stat"><div className="k">Net revenue</div><div className="v">{omr(s.netRevenue)} <small>OMR</small></div></div>
        <div className="stat"><div className="k">Tickets sold</div><div className="v">{s.ticketsSold.toLocaleString()}</div></div>
        <div className="stat"><div className="k">Live events</div><div className="v">{s.eventCount}</div></div>
        <div className="stat"><div className="k">Weyn fees paid</div><div className="v">{omr(s.feePaid)} <small>OMR</small></div></div>
      </div>

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Your events</h2><span>{summary.events.length}</span></div>

      {summary.events.map((e: Weyn) => {
        const left = ticketsLeft(e);
        const out = isSoldOut(e);
        const pct = e.capacity >= 9000 ? 0 : Math.min(100, Math.round((e.sold / e.capacity) * 100));
        const gross = e.sold * e.price;
        return (
          <div key={e.id} className="dash-card">
            <Link to={`/e/${e.id}`} className="dash-row" style={{ marginBottom: 0 }}>
              <div className="thumb" style={e.image ? { backgroundImage: `url(${e.image})` } : { background: e.color }}>
                {!e.image && e.glyph}
              </div>
              <div className="info">
                <b>{e.title}{e.cancelled && <span className="cancelled-tag">Cancelled</span>}</b>
                <span>{dayLabel(e)} · {timeLabel(e)} · {e.area}</span>
                {e.capacity < 9000 && !e.cancelled && <div className="bar"><i className={pct >= 100 ? "full" : ""} style={{ width: `${pct}%` }} /></div>}
              </div>
              <div className="amt">
                <b>{e.price === 0 ? "Free" : `${omr(+gross.toFixed(2))} OMR`}</b>
                <span>{e.cancelled ? "—" : out ? "Sold out" : e.capacity >= 9000 ? `${e.sold} in` : `${left} left`}</span>
              </div>
            </Link>
            {!e.cancelled && (
              <div className="dash-actions">
                <button onClick={() => setEditing(e)}><i className="ti ti-pencil" /> Edit</button>
                <button onClick={() => setAttendeesFor(e)}><i className="ti ti-users" /> Attendees</button>
                <button onClick={() => setMarketingFor(e)}><i className="ti ti-speakerphone" /> Marketing</button>
                <button onClick={() => duplicate(e)} disabled={busyId === e.id}><i className="ti ti-copy" /> Duplicate</button>
                <button onClick={() => cancel(e)} disabled={busyId === e.id} className="danger"><i className="ti ti-ban" /> Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      <Link to="/host" className="btn glass" style={{ marginTop: 8 }}><i className="ti ti-plus" /> Host another event</Link>

      {editing && <EditSheet event={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {attendeesFor && <AttendeesSheet event={attendeesFor} onClose={() => setAttendeesFor(null)} />}
      {marketingFor && <MarketingSheet event={marketingFor} onClose={() => setMarketingFor(null)} />}
    </section>
  );
}

/* ---------- Edit sheet ---------- */
function EditSheet({ event, onClose, onSaved }: { event: Weyn; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String(event.price));
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [blurb, setBlurb] = useState(event.blurb);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try {
      await api.updateEvent(event.id, { price: Number(price) || 0, capacity: Number(capacity) || event.capacity, blurb });
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Couldn't save"); setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="install-sheet glass" style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>Edit "{event.title}"</h3>
        <div className="field"><label>Price (OMR)</label><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
        <div className="field"><label>Capacity</label><input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" /></div>
        <div className="field"><label>Description</label><textarea rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></div>
        {err && <p className="errline">{err}</p>}
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        <button className="btn glass" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- Attendees sheet ---------- */
function AttendeesSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.getAttendees(event.id), [event.id]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="install-sheet glass" style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>Attendees — {event.title}</h3>
        {loading && <div className="spin" style={{ margin: "20px auto" }} />}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && (
          (data || []).length > 0 ? (
            <ul className="steps" style={{ maxHeight: 280, overflowY: "auto" }}>
              {data!.map((a, i) => (
                <li key={i}>
                  <i className="ti ti-user" />
                  <span>{a.name || a.email || "Anonymous"}{a.email && a.name && <><br /><small style={{ color: "var(--text-3)" }}>{a.email}</small></>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No named attendees yet — people who book while signed in with Google will show up here.</p>
          )
        )}
        <button className="btn glass" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Marketing sheet (Feature 2: Create Once, Publish Everywhere) ---------- */
function MarketingSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.getMarketing(event.id), [event.id]);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    try { await api.regenerateMarketing(event.id); reload(); } finally { setRegenerating(false); }
  }
  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  const channels = data ? [
    { key: "instagram", label: "Instagram caption", icon: "brand-instagram", text: data.instagram },
    { key: "whatsapp", label: "WhatsApp message", icon: "brand-whatsapp", text: data.whatsapp },
    { key: "telegram", label: "Telegram post", icon: "brand-telegram", text: data.telegram },
    { key: "twitter", label: "X / Twitter post", icon: "brand-x", text: data.twitter },
  ] : [];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="install-sheet glass" style={{ textAlign: "left", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Marketing — {event.title}</h3>
        <p className="hint" style={{ margin: "0 0 14px" }}>
          {data?.aiGenerated ? "Generated with AI." : "Generated from your event details."} Copy and post anywhere.
        </p>
        {loading && <div className="spin" style={{ margin: "20px auto" }} />}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && channels.map((c) => (
          <div key={c.key} className="marketing-card">
            <div className="marketing-card-head">
              <i className={"ti ti-" + c.icon} /> <b>{c.label}</b>
              <button className="copy-btn" onClick={() => copy(c.key, c.text)}>
                <i className={"ti " + (copiedKey === c.key ? "ti-check" : "ti-copy")} /> {copiedKey === c.key ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="marketing-text">{c.text}</pre>
          </div>
        ))}
        <button className="btn glass" onClick={regenerate} disabled={regenerating} style={{ marginTop: 4 }}>
          <i className="ti ti-refresh" /> {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
        <button className="btn glass" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
