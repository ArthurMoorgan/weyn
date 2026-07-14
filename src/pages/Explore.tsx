import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, CATS, type Cat, type Weyn, isToday, isTomorrow, isThisWeekend, isPast, dayLabel, timeLabel } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import Stub from "../components/Stub";
import { dismissSplash } from "../splash";
import Tooltip from "../components/Tooltip";
import { capture } from "../posthog";
import SplitText from "../components/landing/SplitText";

// Explore is one honest list: a featured spotlight up top, then every
// upcoming event as a full-width editorial card, all in one continuous
// scroll — no day-by-day sectioning. An earlier version split the catalog
// into a hero + a "this weekend" grid + day-bucketed sections, which meant
// finding a given event required knowing which bucket it'd landed in; on
// a phone that read as "I can't see everything," not as organized. One
// flat, chronological list is what actually answers "can I see all the
// events" — cleanly, immediately, no hunting through sections. Everything
// is still derived client-side from one events fetch — no extra
// endpoints — so there's a single source of truth.

// Editorial handoff: category shortcuts are circular icon selectors, not
// text pills — one icon per real CATS entry (src/api.ts), not the mockup's
// illustrative Music/Sports/Dining/Arts labels.
const CAT_ICON: Record<Cat | "all", string> = {
  all: "layout-grid",
  music: "music",
  sports: "trophy",
  food: "utensils",
  culture: "theater",
  cars: "car",
  workshop: "hammer",
  community: "users",
};

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// One eyebrow line up top: category + a broad time framing ("This
// weekend"/"This July") rather than the exact date — the hero is meant to
// read at a glance, the exact date/time already has its own row below.
function heroTimeLabel(e: Weyn): string {
  if (isToday(e)) return "Today";
  if (isTomorrow(e)) return "Tomorrow";
  if (isThisWeekend(e)) return "This weekend";
  return "This " + new Date(e.startsAt).toLocaleDateString("en-GB", { month: "long" });
}

// One card's worth of the spotlight carousel's content — pulled out of the
// old single-slide HeroCard so HeroCarousel below can render N of these in
// a swipeable track instead of one static card.
function HeroSlide({ e, showBadge = true }: { e: Weyn; showBadge?: boolean }) {
  const catLabel = CATS.find((c) => c.key === e.cat)?.label || e.cat;
  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    : { background: e.color };
  return (
    <Link to={`/e/${e.id}`} viewTransition className="ex-hero-card" style={coverStyle}>
      {/* Editorial handoff: a "FEATURED" pill badge top-left — pixel-checked
          against screenshots/01, was missing entirely. Suppressed when
          HeroCarousel is showing its own progress bar in the same top-left
          corner (the "top lines thing" overlapping this badge was the bug
          report) — the progress bar already signals "these are featured,"
          the badge would be redundant right on top of it. */}
      {showBadge && <span className="ex-hero-card-featured">Featured</span>}
      <div className="ex-hero-card-body">
        <span className="ex-hero-card-eyebrow">{catLabel} · {heroTimeLabel(e)}</span>
        <h2 className="ex-hero-card-title">{e.title}</h2>
        <div className="ex-hero-card-meta">
          <span><i className="icon-map-pin" /> {e.venue || e.area}</span>
          <span><i className="icon-calendar" /> {dayLabel(e)} · {timeLabel(e)}</span>
        </div>
        <div className="ex-hero-card-cta">
          {/* Handoff spec: "white pill CTA button" over the photo — a
              distinct style from the app's standard black/coral .btn. */}
          <span className="ex-hero-card-btn">Get tickets</span>
          <span className="ex-hero-card-price">{e.price === 0 ? "Free" : <>from <b>{e.price} OMR</b></>}</span>
        </div>
      </div>
    </Link>
  );
}

// Full-bleed, swipeable spotlight — the single static hero card read as flat
// against the rest of the app; this is the "some life in it" version:
// several featured events as full-bleed slides you swipe between (like a
// Stories rail), with segmented progress bars up top instead of plain dots
// so it reads as "a few things to see," not just a carousel. There's no
// custom dismiss gesture — it's simply the top of the normal page scroll,
// so scrolling down past it *is* "sliding up to return to the normal UI,"
// no separate modal/overlay state to manage.
function HeroCarousel({ events }: { events: Weyn[] }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }

  function goTo(i: number) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  if (events.length <= 1) return events[0] ? <HeroSlide e={events[0]} /> : null;

  return (
    <div className="ex-hero-carousel">
      <div className="ex-hero-carousel-track" ref={trackRef} onScroll={onScroll}>
        {events.map((e) => (
          <div className="ex-hero-carousel-slide" key={e.id}>
            <HeroSlide e={e} showBadge={false} />
          </div>
        ))}
      </div>
      {/* Segmented progress bars (Stories-style) rather than dots — each
          segment fills solid for a past/current slide, empty for one not
          reached yet, communicating "N of these, you're on #2" at a glance. */}
      <div className="ex-hero-carousel-progress" role="tablist" aria-label="Featured events">
        {events.map((e, i) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`Featured event ${i + 1} of ${events.length}`}
            className={"ex-hero-carousel-seg" + (i <= active ? " filled" : "")}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
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

export default function Explore({ embedded = false }: { embedded?: boolean }) {
  const account = useAccount();
  // The onboarding-redirect that used to live here moved to AuthGate
  // (main.tsx) — Explore now sits behind that gate, so by the time this
  // ever mounts, both onboarding and sign-up are already done. Keeping the
  // check here too would just be dead code that never fires.
  const [cat, setCat] = useState<Cat | "all">("all");
  const [when, setWhenRaw] = useState<"all" | "today" | "tomorrow" | "weekend">("all");
  // "Today" is this app's closest real proxy for the "What Can I Do
  // Tonight?" activation event the business plan defines (open the Tonight
  // view within 24h of install) — there's no separate "Tonight" screen,
  // this quick filter IS that moment. Tracked so activation is actually
  // measurable instead of assumed.
  function setWhen(w: "all" | "today" | "tomorrow" | "weekend") {
    if (w === "today") capture("tonight_view_opened");
    setWhenRaw(w);
  }
  const [q, setQ] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showFilters, setShowFilters] = useState(false);
  // null = no price ceiling set yet (slider sits at the catalog's max, so
  // dragging it down is the only way this ever actually filters anything).
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error, reload } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const searching = q.trim().length > 0;

  // Explore is the app's root route, so the initial-content-loading period
  // here is exactly what the first-launch splash should cover.
  useEffect(() => { if (!loading) dismissSplash(); }, [loading]);

  const suggestions = useMemo(() => buildSuggestions((data || []).filter((e) => !e.cancelled && !isPast(e)), q), [data, q]);

  // Ceiling for the price slider — the highest ticket price in the current
  // catalog, rounded up to a clean number so the track's top end isn't an
  // odd value like "27 OMR".
  const priceCeiling = useMemo(() => {
    const max = Math.max(0, ...((data || []).map((e) => e.price)));
    return Math.max(10, Math.ceil(max / 5) * 5);
  }, [data]);
  const priceValue = maxPrice ?? priceCeiling;
  const activeFilterCount = (when !== "all" ? 1 : 0) + (cat !== "all" ? 1 : 0) + (maxPrice !== null ? 1 : 0);

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
    const priceFiltered = maxPrice === null ? all : all.filter((e) => e.price <= maxPrice);
    const catFiltered = cat === "all" ? priceFiltered : priceFiltered.filter((e) => e.cat === cat);

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
    // Up to 4 swipeable spotlight slides instead of one static hero — see
    // HeroCarousel below. Still just "the best few of featPool," not a
    // second data source.
    const heroPool = featPool.slice(0, 4);
    const heroIds = new Set(heroPool.map((e) => e.id));
    // Every other event, one flat chronological list — see the comment
    // above on why this replaced day/weekend sectioning.
    const rest = catFiltered.filter((e) => !heroIds.has(e.id));
    return { mode: "browse" as const, all: catFiltered, heroPool, rest };
  }, [data, cat, when, q, searching, maxPrice]);

  return (
    <>
      {/* Hero title is suppressed when embedded in Discover — the Discover
          shell owns the header (the Events/Venues segmented toggle + host
          pill) so a second title here would be redundant clutter. */}
      {!searching && !embedded && (
        <section className="ex-hero">
          <div>
            <SplitText
              text="Where to next?"
              tag="h1"
              splitType="chars"
              duration={0.7}
              delay={18}
              from={{ opacity: 0, y: 14 }}
              to={{ opacity: 1, y: 0 }}
              textAlign="left"
              threshold={0}
              rootMargin="0px"
            />
          </div>
          <Link to="/host/events" className="ex-hero-host">Host an event <i className="icon-arrow-right" /></Link>
        </section>
      )}

      <div className="search-wrap" ref={searchWrapRef}>
        <div className="search">
          <span className="search-icon-slot"><i className="icon-search" /></span>
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
          <Tooltip text="Filter events" className="search-filter-tooltip">
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
        <div className="cat-circles">
          {CATS.map((c) => (
            <button
              key={c.key}
              className={"cat-circle" + (cat === c.key ? " on" : "")}
              onClick={() => setCat(c.key as Cat | "all")}
              aria-pressed={cat === c.key}
              /* Each real category already has its own brand color token
                 (--cat-music/--cat-sports/etc, used elsewhere for catpills) —
                 threading it in here gives the row some color without
                 touching the app's actual palette. "All" isn't a real
                 category, so it keeps the neutral gray fallback below. */
              style={c.key === "all" ? undefined : ({ "--cat-color": `var(--cat-${c.key})` } as React.CSSProperties)}
            >
              <span className="cat-circle-ring">
                <i className={"icon-" + CAT_ICON[c.key]} />
              </span>
              <span className="cat-circle-label">{c.label}</span>
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

            <div className="filter-sheet-group">
              <span className="filter-sheet-label">Price · up to {priceValue} OMR</span>
              <input
                type="range"
                className="price-slider"
                min={0}
                max={priceCeiling}
                step={5}
                value={priceValue}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMaxPrice(v >= priceCeiling ? null : v);
                }}
                aria-label="Maximum price"
              />
            </div>

            <div className="filter-sheet-actions">
              <button className="btn glass" onClick={() => { setWhen("all"); setCat("all"); setMaxPrice(null); }}>Clear all</button>
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

      {/* ---- discovery: one hero + every other event, one flat list ---- */}
      {!loading && !error && S.mode === "browse" && (
        S.all.length === 0 ? (
          <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing on in this category yet.</p></div>
        ) : (
          <>
            {S.heroPool.length > 0 && <HeroCarousel events={S.heroPool} />}
            {S.rest.length > 0 && (
              <section className="ex-section">
                <div className="ex-head">
                  <h2>All events</h2>
                  <span className="ex-sub">{S.rest.length}</span>
                </div>
                <div className="ex-agenda">{S.rest.map((e) => <Stub key={e.id} e={e} variant="card" />)}</div>
              </section>
            )}
          </>
        )
      )}

      {!account && !loading && (
        <p className="ex-footnote">Sign in on the <strong>You</strong> tab to save events and follow organizers.</p>
      )}
    </>
  );
}
