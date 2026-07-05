import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, CATS, type Cat, type Weyn, isTonight, isToday, isTomorrow, isThisWeekend, dayLabel, timeLabel } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import Stub from "../components/Stub";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import { dismissSplash } from "../splash";

// Explore is built around DISCOVERY, not a single vertical feed. Sections
// get different visual treatments: a Featured hero rail, horizontal
// scroll rails for time/category slices, and a dense list for the long
// tail. Everything is derived client-side from one events fetch — no extra
// endpoints — so it stays fast and there's a single source of truth.

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// horizontal-scroll rail of cards, with a header. Renders nothing if empty.
// `dense` (desktop-only, see .ex-rail.dense in index.css) wraps the rail
// into a grid instead of a horizontal scroller — the "denser grid" half of
// the desktop magazine layout, so the extra width does something besides
// stretching the same scrollbar wider.
function Rail({ title, subtitle, events, variant = "rail", dense = false, className = "" }: { title: string; subtitle?: string; events: Weyn[]; variant?: "rail" | "feature"; dense?: boolean; className?: string }) {
  if (!events.length) return null;
  return (
    <section className={"ex-section" + (className ? " " + className : "")}>
      <div className="ex-head">
        <h2>{title}</h2>
        {subtitle && <span className="ex-sub">{subtitle}</span>}
      </div>
      <div className={"ex-rail" + (variant === "feature" ? " feature" : "") + (dense ? " dense" : "")}>
        {events.map((e) => <Stub key={e.id} e={e} variant={variant} />)}
      </div>
    </section>
  );
}

// Desktop-only (see .ex-magazine-hero in index.css, hidden below 900px) —
// one full-width editorial banner for the single best "featured" event,
// standing in for the mobile Featured rail's first card but with real
// magazine-cover weight: full-bleed image, large title, one clear CTA.
// The mobile Featured rail stays exactly as-is; this doesn't replace data,
// only how the top event is presented on wide screens.
function MagazineHero({ e }: { e: Weyn }) {
  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    : { background: e.color };
  return (
    <Link to={`/e/${e.id}`} className="ex-magazine-hero" style={coverStyle}>
      <div className="ex-magazine-body">
        <span className="ex-magazine-organizer">{e.organizer}</span>
        <h2 className="ex-magazine-title">{e.title}</h2>
        <div className="ex-magazine-meta">
          <span>{dayLabel(e)} · {timeLabel(e)}</span>
          <span className="ec-dot">·</span>
          <span>{e.venue || e.area}</span>
        </div>
        <span className="btn lg ex-magazine-cta">View event <i className="icon-arrow-right" /></span>
      </div>
    </Link>
  );
}

// Live suggestions are derived client-side from the same events list Explore
// already fetches — titles, organizers, venues/areas, and categories that
// match what's been typed so far. No new endpoint.
type Suggestion = { kind: "event" | "organizer" | "place" | "category"; label: string; sub?: string; value: string };

function buildSuggestions(all: Weyn[], q: string): Suggestion[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  for (const c of CATS) {
    if (c.key === "all") continue;
    if (c.label.toLowerCase().includes(t) && !seen.has("cat:" + c.key)) {
      seen.add("cat:" + c.key);
      out.push({ kind: "category", label: c.label, sub: "Category", value: c.label });
    }
  }
  for (const e of all) {
    if (out.length >= 8) break;
    if (e.title.toLowerCase().includes(t) && !seen.has("ev:" + e.id)) {
      seen.add("ev:" + e.id);
      out.push({ kind: "event", label: e.title, sub: `${e.venue} · ${e.area}`, value: e.title });
    }
  }
  for (const e of all) {
    if (out.length >= 10) break;
    if (e.organizer.toLowerCase().includes(t) && !seen.has("org:" + e.organizer)) {
      seen.add("org:" + e.organizer);
      out.push({ kind: "organizer", label: e.organizer, sub: "Organizer", value: e.organizer });
    }
  }
  for (const e of all) {
    if (out.length >= 12) break;
    if (e.area.toLowerCase().includes(t) && !seen.has("area:" + e.area)) {
      seen.add("area:" + e.area);
      out.push({ kind: "place", label: e.area, sub: "Area", value: e.area });
    }
  }
  return out.slice(0, 8);
}

const SUGGEST_ICON: Record<Suggestion["kind"], string> = {
  event: "calendar-days", organizer: "user", place: "map-pin", category: "tag",
};

export default function Explore() {
  const account = useAccount();
  const nav = useNavigate();
  useEffect(() => {
    if (!localStorage.getItem("weyn.onboarding.completed")) nav("/onboarding", { replace: true });
  }, [nav]);
  const [cat, setCat] = useState<Cat | "all">("all");
  const [when, setWhen] = useState<"all" | "today" | "tomorrow" | "weekend">("all");
  const [q, setQ] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error, reload } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const searching = q.trim().length > 0;

  // Explore is the app's root route, so the initial-content-loading period
  // here is exactly what the first-launch splash should cover.
  useEffect(() => { if (!loading) dismissSplash(); }, [loading]);

  const suggestions = useMemo(() => buildSuggestions((data || []).filter((e) => !e.cancelled), q), [data, q]);

  function chooseSuggestion(s: Suggestion) {
    setQ(s.value);
    setShowSuggest(false);
    setActiveIdx(-1);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggest || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % suggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); chooseSuggestion(suggestions[activeIdx]); }
    else if (e.key === "Escape") { setShowSuggest(false); }
  }

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

    // "When" quick filter (Today/Tomorrow/This weekend) is a fast way to
    // plan without typing — like the rail sections below, but as an
    // explicit, tappable choice rather than something you have to scroll to.
    if (when !== "all") {
      const pred = when === "today" ? isToday : when === "tomorrow" ? isTomorrow : isThisWeekend;
      return { mode: "when" as const, results: catFiltered.filter(pred) };
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
  }, [data, cat, when, q, searching]);

  return (
    <>
      <header className="topbar">
        <Logo wordmark size={26} />
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="icon-map-pin" /> Muscat</span>
        </div>
      </header>

      {!searching && (
        <section className="ex-hero">
          <h1>What's on in Muscat</h1>
          <Link to="/host/events" className="ex-hero-host">Host an event <i className="icon-arrow-right" /></Link>
        </section>
      )}

      <div className="search-wrap" ref={searchWrapRef}>
        <div className="search">
          <i className="icon-search" />
          <input
            ref={searchInputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setShowSuggest(true); setActiveIdx(-1); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search events, venues, tags…"
            role="combobox"
            aria-expanded={showSuggest && suggestions.length > 0}
            aria-autocomplete="list"
            aria-controls="explore-suggest-listbox"
            aria-activedescendant={activeIdx >= 0 ? `explore-suggest-${activeIdx}` : undefined}
          />
          {q && <button className="clearx" onClick={() => { setQ(""); setShowSuggest(false); }} aria-label="Clear"><i className="icon-x" /></button>}
        </div>
        {showSuggest && suggestions.length > 0 && (
          <div className="suggest" role="listbox" id="explore-suggest-listbox">
            {suggestions.map((s, i) => (
              <div
                key={s.kind + s.label}
                id={`explore-suggest-${i}`}
                className={"suggest-item" + (i === activeIdx ? " active" : "")}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={() => chooseSuggestion(s)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <i className={"icon-" + SUGGEST_ICON[s.kind]} />
                <b>{s.label}</b>
                {s.sub && <span>{s.sub}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {!searching && (
        <div className="chips chips-when">
          {(["all", "today", "tomorrow", "weekend"] as const).map((w) => (
            <button key={w} className={"chip" + (when === w ? " on" : "")} onClick={() => setWhen(w)}>
              {w === "all" ? "Any time" : w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "This weekend"}
            </button>
          ))}
        </div>
      )}

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

      {/* ---- "when" quick filter: dense list, same treatment as search ---- */}
      {!loading && !error && S.mode === "when" && (
        S.results.length ? (
          <div className="ex-list">{S.results.map((e) => <Stub key={e.id} e={e} />)}</div>
        ) : (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing found for that time.</p></div>
        )
      )}

      {/* ---- discovery: differentiated sections ---- */}
      {!loading && !error && S.mode === "browse" && (
        S.all.length === 0 ? (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing on in this category yet.</p></div>
        ) : (
          <>
            {S.featPool[0] && <MagazineHero e={S.featPool[0]} />}
            <Rail title="Featured" subtitle="Hand-picked" events={S.featPool} variant="feature" className="ex-featured-rail" />
            <Rail title="Happening tonight" events={S.tonight} dense />
            <Rail title="This weekend" events={S.weekend} dense />
            <Rail title="Popular near you" events={S.popular} dense />
            {S.catRails.map(({ c, list }) => <Rail key={c.key} title={c.label} events={list} dense />)}
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
