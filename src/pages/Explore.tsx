import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, CATS, type Cat, type Weyn, isToday, isTomorrow, isThisWeekend, isPast, dayLabel, timeLabel } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import Stub from "../components/Stub";
import { dismissSplash } from "../splash";
import Tooltip from "../components/Tooltip";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up?";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// Explore is one honest, chronological agenda — a featured spotlight up
// top, then every upcoming event as a full-width editorial card grouped
// under its day ("Today", "Tomorrow", "Sat 12 Jul"). The previous layout
// (Trending + Tonight + Weekend + Popular + per-category rails + All
// upcoming) recycled the same small catalog through six different section
// framings, which read as template filler rather than a busy platform.
// One complete calendar with big imagery is what a small catalog can
// actually back up. Everything is still derived client-side from one
// events fetch — no extra endpoints — so there's a single source of truth.

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// Day-bucket heading: relative names for the two days everyone thinks in
// ("Today"/"Tomorrow"), explicit weekday+date beyond that — always
// unambiguous even when two same-weekday dates are both in the list.
function dayHeading(e: Weyn): string {
  if (isToday(e)) return "Today";
  if (isTomorrow(e)) return "Tomorrow";
  const d = new Date(e.startsAt);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function groupByDay(list: Weyn[]): { heading: string; list: Weyn[] }[] {
  const groups: { heading: string; list: Weyn[] }[] = [];
  for (const e of list) {
    const heading = dayHeading(e);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.list.push(e);
    else groups.push({ heading, list: [e] });
  }
  return groups;
}

// horizontal-scroll rail of cards, with a header. Renders nothing if empty.
function Rail({ title, subtitle, events, variant = "rail", className = "" }: { title: string; subtitle?: string; events: Weyn[]; variant?: "rail" | "feature"; className?: string }) {
  if (!events.length) return null;
  return (
    <section className={"ex-section" + (className ? " " + className : "")}>
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
  // The onboarding-redirect that used to live here moved to AuthGate
  // (main.tsx) — Explore now sits behind that gate, so by the time this
  // ever mounts, both onboarding and sign-up are already done. Keeping the
  // check here too would just be dead code that never fires.
  const [cat, setCat] = useState<Cat | "all">("all");
  const [when, setWhen] = useState<"all" | "today" | "tomorrow" | "weekend">("all");
  const [q, setQ] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = (when !== "all" ? 1 : 0) + (cat !== "all" ? 1 : 0);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error, reload } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const searching = q.trim().length > 0;

  // Explore is the app's root route, so the initial-content-loading period
  // here is exactly what the first-launch splash should cover.
  useEffect(() => { if (!loading) dismissSplash(); }, [loading]);

  const suggestions = useMemo(() => buildSuggestions((data || []).filter((e) => !e.cancelled && !isPast(e)), q), [data, q]);

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
    const all = (data || []).filter((e) => !e.cancelled && !isPast(e)).sort(bySoonest);
    const catFiltered = cat === "all" ? all : all.filter((e) => e.cat === cat);

    if (searching) {
      const t = q.trim().toLowerCase();
      // Searches title/organizer/area/venue/tags (existing) plus the
      // human-readable category label (new) so typing "music" or "car meets"
      // matches events even though `e.cat` itself is a short internal key.
      const results = all.filter((e) => {
        const catLabel = CATS.find((c) => c.key === e.cat)?.label || e.cat;
        return (e.title + " " + e.organizer + " " + e.area + " " + e.venue + " " + catLabel + " " + (e.tags || []).join(" "))
          .toLowerCase().includes(t);
      });
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
    // The full chronological agenda, bucketed by day. catFiltered is already
    // sorted soonest-first, so buckets come out in calendar order for free.
    const agenda = groupByDay(catFiltered);
    return { mode: "browse" as const, all: catFiltered, featPool, agenda };
  }, [data, cat, when, q, searching]);

  return (
    <>
      {!searching && (
        <section className="ex-hero">
          <div>
            <span className="ex-greeting">{greeting()}{account ? `, ${account.name.split(" ")[0]}` : ""} 👋</span>
            <h1>Where to next?</h1>
          </div>
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
          <Tooltip text="Filter events">
            <button
              className={"search-filter-btn" + (activeFilterCount ? " on" : "")}
              onClick={() => setShowFilters(true)}
              aria-label="Filter events"
            >
              <i className="icon-sliders-horizontal" />
              {activeFilterCount > 0 && <span className="search-filter-count">{activeFilterCount}</span>}
            </button>
          </Tooltip>
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
        <div className="chips chips-when chips-desktop-only">
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

      {!searching && when !== "all" && (
        <div className="chips chips-mobile-only active-filter-summary">
          <button className="chip on" onClick={() => setWhen("all")}>
            {when === "today" ? "Today" : when === "tomorrow" ? "Tomorrow" : "This weekend"} <i className="icon-x" />
          </button>
        </div>
      )}

      {showFilters && (
        <div className="filter-sheet-backdrop" onClick={() => setShowFilters(false)}>
          <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="filter-sheet-head">
              <h3>Filter events</h3>
              <button className="clearx" onClick={() => setShowFilters(false)} aria-label="Close"><i className="icon-x" /></button>
            </div>

            <div className="filter-sheet-group">
              <span className="filter-sheet-label">When</span>
              <div className="chips">
                {(["all", "today", "tomorrow", "weekend"] as const).map((w) => (
                  <button key={w} className={"chip" + (when === w ? " on" : "")} onClick={() => setWhen(w)}>
                    {w === "all" ? "Any time" : w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "This weekend"}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-sheet-group">
              <span className="filter-sheet-label">Category</span>
              <div className="chips">
                {CATS.map((c) => (
                  <button key={c.key} className={"chip" + (cat === c.key ? " on" : "")} onClick={() => setCat(c.key as Cat | "all")}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-sheet-actions">
              <button className="btn glass" onClick={() => { setWhen("all"); setCat("all"); }}>Clear all</button>
              <button className="btn lg" onClick={() => setShowFilters(false)}>Show results</button>
            </div>
          </div>
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

      {/* ---- "when" quick filter: same editorial cards as the agenda ---- */}
      {!loading && !error && S.mode === "when" && (
        S.results.length ? (
          <div className="ex-agenda">{S.results.map((e) => <Stub key={e.id} e={e} variant="card" />)}</div>
        ) : (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing found for that time.</p></div>
        )
      )}

      {/* ---- discovery: spotlight + chronological day-grouped agenda ---- */}
      {!loading && !error && S.mode === "browse" && (
        S.all.length === 0 ? (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing on in this category yet.</p></div>
        ) : (
          <>
            {S.featPool[0] && <MagazineHero e={S.featPool[0]} />}
            {/* Mobile spotlight — one big editorial cover card for the top
                featured event (the desktop equivalent is MagazineHero above,
                which is hidden below 900px just as this is hidden above it). */}
            {S.featPool[0] && (
              <div className="ex-spotlight">
                <Stub e={S.featPool[0]} variant="feature" />
              </div>
            )}
            {/* No "Hand-picked" subtitle — featPool falls back to
                most-popular when nothing is actually flagged featured, and
                claiming curation that isn't happening is exactly the kind of
                fake-signal copy this redesign removes. */}
            {S.featPool.length > 1 && (
              <Rail title="Featured" events={S.featPool.slice(1)} variant="feature" className="ex-featured-rail" />
            )}
            {S.agenda.map(({ heading, list }) => (
              <section className="ex-section" key={heading}>
                <div className="ex-head">
                  <h2>{heading}</h2>
                  {list.length > 1 && <span className="ex-sub">{list.length} events</span>}
                </div>
                <div className="ex-agenda">{list.map((e) => <Stub key={e.id} e={e} variant="card" timeOnly />)}</div>
              </section>
            ))}
          </>
        )
      )}

      {!account && !loading && (
        <p className="ex-footnote">Sign in on the <strong>You</strong> tab to save events and follow organizers.</p>
      )}
    </>
  );
}
