import { useMemo, useState } from "react";
import { api, CATS, type Cat, type Weyn, isTonight, isThisWeekend } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import Stub from "../components/Stub";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

// Explore is built around DISCOVERY, not a single vertical feed. Sections
// get different visual treatments: a Featured hero rail, horizontal
// scroll rails for time/category slices, and a dense list for the long
// tail. Everything is derived client-side from one events fetch — no extra
// endpoints — so it stays fast and there's a single source of truth.

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// horizontal-scroll rail of cards, with a header. Renders nothing if empty.
function Rail({ title, subtitle, events, variant = "rail" }: { title: string; subtitle?: string; events: Weyn[]; variant?: "rail" | "feature" }) {
  if (!events.length) return null;
  return (
    <section className="ex-section">
      <div className="ex-head">
        <h2>{title}</h2>
        {subtitle && <span className="ex-sub">{subtitle}</span>}
      </div>
      <div className={"ex-rail" + (variant === "feature" ? " feature" : "")}>
        {events.map((e) => <Stub key={e.id} e={e} variant={variant} />)}
      </div>
    </section>
  );
}

export default function Explore() {
  const account = useAccount();
  const [cat, setCat] = useState<Cat | "all">("all");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.listEvents(), []);
  const searching = q.trim().length > 0;

  // one fetch → many derived sections
  const S = useMemo(() => {
    const all = (data || []).filter((e) => !e.cancelled).sort(bySoonest);
    const catFiltered = cat === "all" ? all : all.filter((e) => e.cat === cat);

    if (searching) {
      const t = q.trim().toLowerCase();
      const results = all.filter((e) =>
        (e.title + " " + e.organizer + " " + e.area + " " + e.venue + " " + (e.tags || []).join(" "))
          .toLowerCase().includes(t)
      );
      return { mode: "search" as const, results };
    }

    const featured = [...catFiltered].filter((e) => e.featured).slice(0, 6);
    const featPool = featured.length ? featured : [...catFiltered].sort(byPopular).slice(0, 5);
    const tonight = catFiltered.filter(isTonight);
    const weekend = catFiltered.filter(isThisWeekend);
    const popular = [...catFiltered].sort(byPopular).slice(0, 10);
    // category rails only make sense when browsing "all"
    const catRails = cat === "all"
      ? CATS.filter((c) => c.key !== "all")
          .map((c) => ({ c, list: all.filter((e) => e.cat === c.key).slice(0, 10) }))
          .filter((x) => x.list.length >= 2)
      : [];
    return { mode: "browse" as const, all: catFiltered, featPool, tonight, weekend, popular, catRails };
  }, [data, cat, q, searching]);

  return (
    <>
      <header className="topbar">
        <Logo wordmark size={26} />
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="icon-map-pin" /> Muscat</span>
        </div>
      </header>

      <div className="search">
        <i className="icon-search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, venues, tags…" />
        {q && <button className="clearx" onClick={() => setQ("")} aria-label="Clear"><i className="icon-x" /></button>}
      </div>

      {!searching && (
        <div className="chips">
          {CATS.map((c) => (
            <button key={c.key} className={"chip" + (cat === c.key ? " on" : "")} onClick={() => setCat(c.key as Cat | "all")}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="ex-list">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
        </div>
      )}

      {error && (
        <div className="empty">
          <div className="ic"><i className="icon-cloud-off" /></div>
          <p>Couldn't load events. {error}</p>
          <button className="btn glass" style={{ maxWidth: 200, margin: "0 auto" }} onClick={reload}>Try again</button>
        </div>
      )}

      {/* ---- search results: dense list ---- */}
      {!loading && !error && S.mode === "search" && (
        S.results.length ? (
          <div className="ex-list">{S.results.map((e) => <Stub key={e.id} e={e} />)}</div>
        ) : (
          <div className="empty"><div className="ic"><i className="icon-search-x" /></div><p>No matches for "{q}".</p></div>
        )
      )}

      {/* ---- discovery: differentiated sections ---- */}
      {!loading && !error && S.mode === "browse" && (
        S.all.length === 0 ? (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing on in this category yet.</p></div>
        ) : (
          <>
            <Rail title="Featured" subtitle="Hand-picked" events={S.featPool} variant="feature" />
            <Rail title="Happening tonight" events={S.tonight} />
            <Rail title="This weekend" events={S.weekend} />
            <Rail title="Popular near you" events={S.popular} />
            {S.catRails.map(({ c, list }) => <Rail key={c.key} title={c.label} events={list} />)}
            <section className="ex-section">
              <div className="ex-head"><h2>All upcoming</h2><span className="ex-sub">{S.all.length} events</span></div>
              <div className="ex-list">{S.all.map((e) => <Stub key={e.id} e={e} />)}</div>
            </section>
          </>
        )
      )}

      {!account && !loading && (
        <p className="ex-footnote">Sign in on the <strong>You</strong> tab to save events and follow organizers.</p>
      )}
    </>
  );
}
