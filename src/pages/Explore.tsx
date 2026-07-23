import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, MotionConfig } from "motion/react";
import { MotionButton, usePrefersReducedMotion } from "../motion";
import { api, CATS, type Cat, type Weyn, isToday, isTomorrow, isThisWeekend, isPast } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import { addRecentSearch, getRecentSearches, clearRecentSearches } from "../hooks/useRecentSearches";
import Stub from "../components/Stub";
import CategoryIcon from "../components/CategoryIcon";
import HorizontalRail from "../components/HorizontalRail";
import { useRecommendations } from "../hooks/useRecommendations";
import { dismissSplash } from "../splash";
import Tooltip from "../components/Tooltip";
import { capture } from "../posthog";
// Lazy: SplitText pulls in gsap (~heavy), and it only renders in the
// non-embedded standalone hero — the running app always uses <Explore
// embedded /> (the Discover shell owns the header), so gsap was being
// bundled into the entry chunk for a heading that never shows in-app.
// Lazy import keeps gsap out of the critical path; the Suspense fallback
// renders the heading text immediately (animation is pure enhancement).
const SplitText = lazy(() => import("../components/landing/SplitText"));

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

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);

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
  const [searchParams] = useSearchParams();
  // The onboarding-redirect that used to live here moved to AuthGate
  // (main.tsx) — Explore now sits behind that gate, so by the time this
  // ever mounts, both onboarding and sign-up are already done. Keeping the
  // check here too would just be dead code that never fires.
  const [cat, setCat] = useState<Cat | "all">(() => {
    const param = searchParams.get("cat");
    return (param && CATS.find(c => c.key === param)) ? (param as Cat | "all") : "all";
  });
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
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  // null = no price ceiling set yet (slider sits at the catalog's max, so
  // dragging it down is the only way this ever actually filters anything).
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  // Home header (search + niche tiles) sticks to the top on scroll and turns
  // glassy once the page has moved (see .home-topstick / .stuck). The page's
  // scroll container is <body> (overflow:auto), not window — so the listener
  // and scroll position both read off document.body.
  const [stuck, setStuck] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 1px sentinel above the sticky header; when it scrolls out of view the
  // header has pinned, so we flip .stuck. IntersectionObserver instead of a
  // scroll listener because the page scroller is <body>, whose scroll-event
  // routing is unreliable — IO reacts to layout, not events.
  const stickSentinelRef = useRef<HTMLDivElement>(null);
  const { data, loading, error, reload } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const searching = q.trim().length > 0;

  // Explore is the app's root route, so the initial-content-loading period
  // here is exactly what the first-launch splash should cover.
  useEffect(() => { if (!loading) dismissSplash(); }, [loading]);

  // Load recent searches when q becomes empty
  useEffect(() => {
    if (!q.trim()) {
      setRecentSearches(getRecentSearches());
    }
  }, [q]);

  // Sticky-header glass toggle (embedded home only). A 1px sentinel sits just
  // above the sticky header; once it scrolls out of the viewport the header
  // has pinned, so we flip .stuck. IntersectionObserver (not a scroll
  // listener) because <body> is the scroller and its scroll events don't fire
  // reliably — IO reacts to layout instead.
  useEffect(() => {
    if (!embedded) return;
    const el = stickSentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [embedded]);

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
    if (e.key === "Enter" && q.trim()) {
      e.preventDefault();
      addRecentSearch(q.trim());
      setShowSuggest(false);
      return;
    }
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

    // One flat chronological list, no spotlight carve-out (removed — it was
    // glitchy) — see the comment above on why this replaced day/weekend
    // sectioning.
    return { mode: "browse" as const, all: catFiltered, rest: catFiltered };
  }, [data, cat, when, q, searching, maxPrice]);

  // The home feed is a stack of curated rows (spotlight, Today, Tomorrow,
  // Recommended for you, Near you, then everything else) carved out of the
  // same one `S.rest` list, in that priority order — every row's Stub cover
  // shares a `layoutId` keyed only by event id (the card→hero morph target),
  // so the same event mounted in two rows at once is exactly what caused a
  // spotlighted card to randomly disappear/jump: Framer Motion was measuring
  // one against the other instead of treating them as independent. Each row
  // below draws from what the previous rows didn't already claim, so every
  // event appears in at most one row on screen at a time.
  // Featured events first (both keep their existing chronological order
  // among themselves — S.rest is already soonest-first), then fill any
  // remaining slots with whatever's next up. Plain "first 8 soonest" meant
  // the spotlight — a section literally badged "Featured" on some cards —
  // was really just "today's earliest events," which also silently ate the
  // entire Today row on any day with 8+ things happening.
  const spotlightEvents = useMemo(() => {
    if (S.mode !== "browse") return [];
    const featured = S.rest.filter((e) => e.featured);
    const rest = S.rest.filter((e) => !e.featured);
    return [...featured, ...rest].slice(0, 8);
  }, [S]);
  const afterSpotlight = useMemo(() => {
    if (S.mode !== "browse") return [];
    const ids = new Set(spotlightEvents.map((e) => e.id));
    return S.rest.filter((e) => !ids.has(e.id));
  }, [S, spotlightEvents]);

  const todayEvents = useMemo(() => afterSpotlight.filter(isToday).slice(0, 10), [afterSpotlight]);
  const afterToday = useMemo(() => {
    if (todayEvents.length === 0) return afterSpotlight;
    const ids = new Set(todayEvents.map((e) => e.id));
    return afterSpotlight.filter((e) => !ids.has(e.id));
  }, [afterSpotlight, todayEvents]);

  const tomorrowEvents = useMemo(() => afterToday.filter(isTomorrow).slice(0, 10), [afterToday]);
  const afterTomorrow = useMemo(() => {
    if (tomorrowEvents.length === 0) return afterToday;
    const ids = new Set(tomorrowEvents.map((e) => e.id));
    return afterToday.filter((e) => !ids.has(e.id));
  }, [afterToday, tomorrowEvents]);

  // Personalized "for you" row — derived client-side from saved + recently
  // viewed (see useRecommendations), scoped to whatever Today/Tomorrow didn't
  // already claim. Re-ranks live as the user saves events.
  const recs = useRecommendations(afterTomorrow);
  const afterRecs = useMemo(() => {
    if (!recs.hasSignal || recs.events.length === 0) return afterTomorrow;
    const ids = new Set(recs.events.map((e) => e.id));
    return afterTomorrow.filter((e) => !ids.has(e.id));
  }, [afterTomorrow, recs]);

  // "Near you" — same distanceKm the list rows already surface (see Stub's
  // "list" variant), just sorted instead of filtered. No separate geolocation
  // request: distanceKm already reflects the visitor's location server-side.
  const nearYouEvents = useMemo(
    () => [...afterRecs].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 10),
    [afterRecs]
  );
  const restForList = useMemo(() => {
    if (nearYouEvents.length === 0) return afterRecs;
    const ids = new Set(nearYouEvents.map((e) => e.id));
    return afterRecs.filter((e) => !ids.has(e.id));
  }, [afterRecs, nearYouEvents]);

  // Extracted so the embedded home can nest them inside the sticky
  // .home-topstick wrapper while the standalone page renders them flat —
  // same markup, one source of truth (no duplication).
  const searchBlock = (
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
  );

  const recentBlock = !searching && recentSearches.length > 0 ? (
    <div className="recent-searches">
      <div className="recent-searches-header">
        <span className="recent-searches-label">Recent searches</span>
        <button
          className="recent-searches-clear"
          onClick={() => { clearRecentSearches(); setRecentSearches([]); }}
          aria-label="Clear recent searches"
        >
          Clear
        </button>
      </div>
      <div className="chips">
        {recentSearches.map((search) => (
          <button key={search} className="chip" onClick={() => setQ(search)}>
            {search}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    // reducedMotion="user" makes every motion.* component below (the hero
    // carousel's spring drag, the category circles' spring pop) respect the
    // OS-level "reduce motion" setting automatically — instant snaps instead
    // of springs, without a bespoke @media check on every one of them.
    // Redundant now that main.tsx wraps the whole app in the same
    // MotionConfig — kept anyway: nesting is harmless (the inner value just
    // repeats the outer one) and keeps this file self-contained if Explore
    // is ever rendered standalone outside the app shell again.
    <MotionConfig reducedMotion="user">
    <>
      {/* Hero title is suppressed when embedded in Discover — the Discover
          shell owns the header (the Events/Venues segmented toggle + host
          pill) so a second title here would be redundant clutter. */}
      {!searching && !embedded && (
        <section className="ex-hero">
          {/* No home-hub tile to morph from anymore (Events/Reserve tiles were
              removed) — just a plain header icon now. */}
          <span className="ex-hero-nav-icon" aria-hidden="true"><i className="icon-ticket-fill" /></span>
          <div>
            <Suspense fallback={<h1 style={{ textAlign: "left" }}>Where to next?</h1>}>
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
            </Suspense>
          </div>
        </section>
      )}

      {/* Embedded home: the search bar lives in a sticky glass header (see
          .home-topstick — pins to the top and frosts once scrolled). The
          Events/Reserve tiles now scroll away normally underneath it — the
          persistent bottom nav (App.tsx) handles navigation globally, so the
          tiles no longer need to hide/replace themselves on scroll.
          Standalone Events page keeps everything flat with the filter chips. */}
      {embedded ? (
        <>
          <div ref={stickSentinelRef} className="topstick-sentinel" aria-hidden="true" />
          <div className={"home-topstick" + (stuck ? " stuck" : "")}>
            {searchBlock}
            {recentBlock}
          </div>
        </>
      ) : (
        <>
          {searchBlock}
          {recentBlock}
          {/* EVENTS PAGE (standalone /explore): the "When" quick filter and
              category chips — filtering, not top-level navigation. */}
          {!searching && (
            <>
              <div className="chips chips-when">
                {(["all", "today", "tomorrow", "weekend"] as const).map((w) => (
                  <button key={w} className={"chip" + (when === w ? " on" : "")} onClick={() => setWhen(w)}>
                    {w === "all" ? "Any time" : w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "This weekend"}
                  </button>
                ))}
              </div>
              <div className="chips chips-categories">
                {CATS.filter((c) => c.key !== "all").map((c) => {
                  const isOn = cat === c.key;
                  return (
                    <button
                      key={c.key}
                      className={"chip" + (isOn ? " on" : "")}
                      onClick={() => setCat(isOn ? "all" : (c.key as Cat))}
                      aria-pressed={isOn}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {!searching && when !== "all" && (
            <div className="chips chips-mobile-only active-filter-summary">
              <button className="chip on" onClick={() => setWhen("all")}>
                {when === "today" ? "Today" : when === "tomorrow" ? "Tomorrow" : "This weekend"} <i className="icon-x" />
              </button>
            </div>
          )}
        </>
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
              <MotionButton className="btn glass" onClick={() => { setWhen("all"); setCat("all"); setMaxPrice(null); }}>Clear all</MotionButton>
              <MotionButton className="btn lg" onClick={() => setShowFilters(false)}>Show results</MotionButton>
            </div>
          </div>
        </div>
      )}

      {/* Shape matches whatever will actually render once loaded — `searching`
          (the only state known before data arrives) is the same switch the
          real results below use. Search results render as .ec-row list rows
          (Stub's default "list" variant), so a row skeleton fits; both
          "when" and "browse" render full-width .ec-card covers (variant=
          "card"), so those get the taller card skeleton instead — previously
          every case got the row skeleton, which flashed a mismatched shape
          right before the real full-width cards popped in. */}
      {loading && (
        searching ? (
          <div className="ex-list">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
          </div>
        ) : (
          <div className="ex-agenda">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-cardrow">
                <span className="sk sk-cover" />
                <span className="sk sk-line" style={{ width: "70%", height: 13 }} />
                <span className="sk sk-line" style={{ width: "45%", height: 11 }} />
              </div>
            ))}
          </div>
        )
      )}

      {error && (
        <div className="empty">
          <div className="ic"><i className="icon-cloud-off" /></div>
          <p>Couldn't load events. {error}</p>
          <MotionButton className="btn glass" style={{ maxWidth: 200, margin: "0 auto" }} onClick={reload}>Try again</MotionButton>
        </div>
      )}

      {/* ---- search results: dense list ---- */}
      {!loading && !error && S.mode === "search" && (
        S.results.length ? (
          <div className="ex-list">
            {S.results.map((e) => (
              <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                <Stub e={e} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="empty"><div className="ic"><i className="icon-search-x" /></div><p>No matches for "{q}".</p></div>
        )
      )}

      {/* ---- "when" quick filter: same editorial cards as the agenda ---- */}
      {!loading && !error && S.mode === "when" && (
        S.results.length ? (
          <div className="ex-agenda">
            {S.results.map((e) => (
              <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                <Stub e={e} variant="card" />
              </motion.div>
            ))}
          </div>
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
            {/* Categories + In the spotlight are home-screen sections — the
                standalone /explore page already has its own When/category
                chip filters, so these would just duplicate that there. */}
            {embedded && (
              <section className="ex-section">
                <div className="ex-head"><h2>Categories</h2></div>
                <div className="ex-rail">
                  {CATS.filter((c) => c.key !== "all").map((c) => (
                    <Link key={c.key} to={`/explore?cat=${c.key}`} className="category-tile">
                      <CategoryIcon name={c.key} size={18} />
                      <span className="category-tile-label">{c.label}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {embedded && S.rest.length > 0 && (
              <FeaturedSpotlight events={spotlightEvents} />
            )}
            {embedded && todayEvents.length > 0 && (
              <HorizontalRail title="Today" events={todayEvents} emptyMessage="" />
            )}
            {embedded && tomorrowEvents.length > 0 && (
              <HorizontalRail title="Tomorrow" events={tomorrowEvents} emptyMessage="" />
            )}
            {/* Personalized row — only on the unfiltered home (a category filter
                is already an explicit intent; don't compete with it) and only
                once there's enough saved/viewed signal to be genuinely personal
                (useRecommendations gates on MIN_SIGNAL). */}
            {cat === "all" && recs.hasSignal && recs.events.length > 0 && (
              <HorizontalRail
                title="Recommended for you"
                events={recs.events}
                emptyMessage=""
              />
            )}
            {embedded && nearYouEvents.length > 0 && (
              <HorizontalRail title="Near you" events={nearYouEvents} emptyMessage="" />
            )}
            {restForList.length > 0 && embedded && (
              <section className="ex-section">
                <div className="ex-head">
                  <h2>All events</h2>
                  <span className="ex-sub">{restForList.length}</span>
                </div>
                {/* Circular-thumb + title + one meta line, matching the
                    reference design's list-row style exactly — replaces the
                    full editorial card here (that variant stays as-is for
                    the standalone /explore page below). Excludes whatever's
                    already up in the spotlight above (see spotlightEvents/
                    restForList) so no event is mounted twice at once. */}
                <div className="ex-avatar-list">
                  {restForList.map((e) => (
                    <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                      <Stub e={e} variant="avatar" />
                    </motion.div>
                  ))}
                </div>
              </section>
            )}
            {S.rest.length > 0 && !embedded && (
              <section className="ex-section">
                <div className="ex-head">
                  <h2>All events</h2>
                  <span className="ex-sub">{S.rest.length}</span>
                </div>
                <div className="ex-agenda">
                  {S.rest.map((e) => (
                    <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                      <Stub e={e} variant="card" />
                    </motion.div>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}

      {!account && !loading && (
        <p className="ex-footnote">Sign in on the <strong>You</strong> tab to save events and follow organizers.</p>
      )}
    </>
    </MotionConfig>
  );
}

// "In the spotlight" — replaces the old "Top events" peek-row with a real
// center-dominant carousel (reuses Stub's existing default/.ec-feature
// variant — already sized for exactly this, "min(85vw, 360px)"). Deliberately
// plain CSS scroll-snap, not a drag/spring carousel — an earlier
// spring-physics spotlight was pulled for being "too glitchy" (see git
// history); this is the same robust mechanism used elsewhere in the app
// (.ex-rail/.horizontal-rail) applied to a bigger card. Leading/trailing
// spacers give the FIRST and LAST card the same both-side peek every
// interior card gets for free from flex gap — without them, scroll-snap has
// nothing to center the edge cards against and they'd sit flush to the
// screen edge with no peek.
// Coverflow-style: the centered card reads full-strength, its two neighbors
// sit faded/scaled back so the "one in focus, more coming on each side" shape
// is visible even before anything moves. Auto-advances one card at a time on
// a loop (pausing the moment the user actually touches/scrolls it, resuming
// a few seconds after they let go) — a timer fighting an in-progress swipe is
// exactly what used to read as the rail "randomly" jumping around.
function FeaturedSpotlight({ events }: { events: Weyn[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const reduced = usePrefersReducedMotion();
  const pausedRef = useRef(false);
  const resumeTimerRef = useRef<number>();

  useEffect(() => { activeRef.current = active; }, [active]);

  // Shared by the initial layout, resize, and autoplay-advance paths so
  // "centered" always means the same thing: card i sits exactly in the
  // middle of the rail, not flush to an edge.
  const centerOn = (index: number, smooth: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-spot-card]"));
    const target = cards[index];
    if (!target) return;
    track.scrollTo({
      left: target.offsetLeft + target.offsetWidth / 2 - track.clientWidth / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  // Size the leading/trailing spacers so the FIRST and LAST card can each
  // reach dead-center with equal peek on both sides — a fixed small "peek"
  // spacer left the first card flush against the screen edge on load
  // instead of centered like every other card once scrolled to.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const firstCard = track?.querySelector<HTMLElement>("[data-spot-card]");
    if (!track || !firstCard) return;
    function size() {
      const spacer = Math.max(0, (track!.clientWidth - firstCard!.offsetWidth) / 2);
      if (leadRef.current) leadRef.current.style.flexBasis = `${spacer}px`;
      if (tailRef.current) tailRef.current.style.flexBasis = `${spacer}px`;
      centerOn(activeRef.current, false);
    }
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-spot-card]"));
    function updateActive() {
      if (!track || cards.length === 0) return;
      const center = track.scrollLeft + track.clientWidth / 2;
      let closest = 0, min = Infinity;
      cards.forEach((c, i) => {
        const mid = c.offsetLeft + c.offsetWidth / 2;
        const d = Math.abs(mid - center);
        if (d < min) { min = d; closest = i; }
      });
      setActive(closest);
    }
    track.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
    return () => track.removeEventListener("scroll", updateActive);
  }, [events]);

  // Any real user interaction pauses autoplay for a few seconds — swiping,
  // dragging a scrollbar, or a trackpad/wheel nudge all count.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    function pause() {
      pausedRef.current = true;
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => { pausedRef.current = false; }, 4000);
    }
    track.addEventListener("pointerdown", pause);
    track.addEventListener("wheel", pause, { passive: true });
    return () => {
      track.removeEventListener("pointerdown", pause);
      track.removeEventListener("wheel", pause);
      window.clearTimeout(resumeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (reduced || events.length <= 1) return;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      const track = trackRef.current;
      if (!track) return;
      const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-spot-card]"));
      if (cards.length === 0) return;
      const next = (activeRef.current + 1) % cards.length;
      centerOn(next, true);
    }, 3500);
    return () => window.clearInterval(id);
  }, [events, reduced]);

  return (
    <section className="ex-section">
      <div className="ex-head">
        <h2>In the spotlight</h2>
        <Link to="/explore" className="ex-see-all">See all <i className="icon-arrow-right" /></Link>
      </div>
      <div className="ex-spotlight-rail" ref={trackRef}>
        <div className="ex-spotlight-spacer" ref={leadRef} aria-hidden="true" />
        {events.map((e, i) => {
          const distance = Math.abs(i - active);
          return (
            <div
              key={e.id}
              data-spot-card
              style={{
                opacity: distance === 0 ? 1 : distance === 1 ? 0.45 : 0.22,
                transform: distance === 0 ? "scale(1.08)" : distance === 1 ? "scale(0.82)" : "scale(0.75)",
              }}
            >
              <Stub e={e} variant="feature" />
            </div>
          );
        })}
        <div className="ex-spotlight-spacer" ref={tailRef} aria-hidden="true" />
      </div>
      {events.length > 1 && (
        <div className="ex-spotlight-dots">
          {events.map((_, i) => <span key={i} className={"ex-spotlight-dot" + (i === active ? " on" : "")} />)}
        </div>
      )}
    </section>
  );
}
