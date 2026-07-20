import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, MotionConfig } from "motion/react";
import { MotionButton, usePrefersReducedMotion } from "../motion";
import { api, CATS, type Cat, type Weyn, isToday, isTomorrow, isThisWeekend, isPast } from "../api";
import { useAsync } from "../hooks";
import { useAccount, useSaved, isSaved, toggleSave } from "../store";
import { addRecentSearch, getRecentSearches, clearRecentSearches } from "../hooks/useRecentSearches";
import Stub from "../components/Stub";
import HorizontalRail from "../components/HorizontalRail";
import { useRecommendations } from "../hooks/useRecommendations";
import { preloadEventDetail } from "../eventDetailChunk";
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
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// The spotlight card IS its own cover (the photo is its background), so the
// layoutId that morphs it into EventDetail's hero has to sit on the <Link>
// itself — hence a motion-wrapped Link rather than a nested motion.div like
// Stub's card covers use.
const MotionLink = motion.create(Link);

// One card's worth of the spotlight carousel's content — pulled out of the
// old single-slide HeroCard so HeroCarousel below can render N of these in
// a swipeable track instead of one static card.
// The spotlight card is now just the photo + a small brand/badge pill and a
// save button (reference-matched: text lives BELOW the deck, not overlaid on
// the image — see FeaturedSpotlight). The whole card is still the tap target
// into the event, and still carries the layoutId that morphs into
// EventDetail's hero.
function HeroSlide({ e, showBadge = true }: { e: Weyn; showBadge?: boolean }) {
  useSaved();
  const saved = isSaved(e.id);
  const catLabel = CATS.find((c) => c.key === e.cat)?.label || e.cat;
  // An opaque `backgroundColor` base is set in BOTH branches so a card is
  // never see-through — critical in the stacked spotlight deck, where cards
  // overlap: without it, a still-loading photo, an image with alpha, or the
  // no-image fallback gradient (which ends at the semi-transparent
  // --fallback-scrim) let the cards *behind* the front card show through, so
  // the front card read as translucent. The gradient/photo paints on top of
  // this solid base.
  const coverStyle: React.CSSProperties = e.image
    ? { backgroundColor: "var(--card-bg)", backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    // Greyscale system: ignore the server-stored per-event hue — same
    // category-grey treatment as Stub.tsx's fallback covers. Fallback
    // references --cat-music itself (not a duplicated hex) so it can't
    // silently drift from that token.
    : { backgroundColor: "var(--card-bg)", backgroundImage: `linear-gradient(150deg, var(--cat-${e.cat}, var(--cat-music)), var(--fallback-scrim))` };
  return (
    <MotionLink to={`/e/${e.id}`} layoutId={`event-cover-${e.id}`} onPointerDown={preloadEventDetail} onMouseEnter={preloadEventDetail} className="ex-hero-card" style={coverStyle}>
      {/* Brand/category pill top-left (reference: "District Live") + a save
          button top-right — the only two things that sit ON the photo now. */}
      {showBadge && <span className="ex-hero-card-featured">{catLabel}</span>}
      {showBadge && (
        <button
          className={"ex-hero-card-save" + (saved ? " on" : "")}
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); toggleSave(e.id); }}
          aria-label={saved ? "Saved — tap to remove" : "Save"}
          aria-pressed={saved}
        >
          <i className="icon-bookmark" />
        </button>
      )}
    </MotionLink>
  );
}

// A real swipeable, horizontally snapping carousel of the events that paid
// for the featured tag (see `heroPool` in the memo below: `.featured` events
// first, most-popular only as a fallback when none are featured) — each card
// is sized so the next one peeks in from the edge, same as the reference.
// Dots below track the nearest-snapped card via a scroll listener rather
// than driving scroll position themselves, so native touch/trackpad
// scrolling stays the source of truth (no fighting the user's gesture).
// Stacked "deck" spotlight: the front event sits centered on top, with the
// next two peeking out from behind it (scaled down + dimmed on either side),
// and the deck auto-advances every few seconds so featured events rotate to
// the front — the layered look from the reference. Positions are driven by
// each card's offset from `active`; CSS (see .ex-deck-card[data-pos]) owns
// the actual transforms so the rotation animates smoothly. Auto-advance
// pauses under prefers-reduced-motion (rotating content is motion too) and
// while the user is touching the deck.
function FeaturedSpotlight({ events }: { events: Weyn[] }) {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = events.length;
  // Swipe/drag state: the deck is absolutely-stacked cards (no native scroll),
  // so we drive next/prev off pointer gestures ourselves. `moved` guards the
  // front card's link — a real swipe must not also navigate into the event.
  const startX = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);

  useEffect(() => {
    if (n <= 1 || reduced || paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % n), 3000);
    return () => clearInterval(t);
  }, [n, reduced, paused]);

  // Clamp active if the event list shrinks (e.g. category switch).
  useEffect(() => { if (active >= n) setActive(0); }, [n, active]);

  const go = (dir: number) => setActive((a) => (((a + dir) % n) + n) % n);

  function onPointerDown(e: React.PointerEvent) {
    startX.current = e.clientX;
    dragging.current = true;
    moved.current = false;
    setPaused(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragging.current && Math.abs(e.clientX - startX.current) > 8) moved.current = true;
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    dragging.current = false;
    setPaused(false);
    if (n > 1 && Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); // swipe left → next
  }
  // If a swipe happened, swallow the click so the front card's link doesn't fire.
  function onClickCapture(e: React.MouseEvent) {
    if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; }
  }

  if (n === 0) return null;
  const front = events[active] || events[0];

  return (
    <div className="ex-spotlight ex-spotlight-deck">
      <div
        className="ex-deck"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => { dragging.current = false; setPaused(false); }}
        onPointerLeave={(e) => { endDrag(e); }}
        onClickCapture={onClickCapture}
      >
        {events.map((ev, i) => {
          const offset = ((i - active) % n + n) % n; // 0 = front … n-1
          // Only the front (0) and the two directly behind (1,2) are visible;
          // everything else parks hidden behind the stack (pos 3).
          const pos = offset <= 2 ? offset : 3;
          return (
            <div className="ex-deck-card" data-pos={pos} key={ev.id} aria-hidden={pos !== 0}>
              <HeroSlide e={ev} showBadge={pos === 0} />
            </div>
          );
        })}
      </div>

      {/* Title + blurb sit BELOW the deck (reference), keyed on the active
          event so they crossfade as the deck rotates. A plain <Link> so the
          caption is tappable into the same event as its card. */}
      <Link to={`/e/${front.id}`} className="ex-spotlight-caption" key={front.id} onPointerDown={preloadEventDetail}>
        <h3 className="ex-spotlight-title">{front.title}</h3>
        {front.blurb && <p className="ex-spotlight-blurb">{front.blurb}</p>}
      </Link>

      {n > 1 && (
        <div className="ex-spotlight-dots">
          {events.map((ev, i) => (
            <button
              key={ev.id}
              className={"ex-spotlight-dot" + (i === active ? " on" : "")}
              onClick={() => setActive(i)}
              aria-label={`Show spotlight ${i + 1}`}
            />
          ))}
        </div>
      )}
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
  // Personalized "for you" row — derived client-side from saved + recently
  // viewed (see useRecommendations). Re-ranks live as the user saves events.
  const recs = useRecommendations(data);

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

  // The 2-tile home hub (embedded) — nested in the sticky header below.
  const hubBlock = !searching ? (
    <div className="cat-circles-hub">
      {[
        { to: "/explore", key: "events", label: "Events", img: "/icons3d/events.png" },
        { to: "/venues", key: "venues", label: "Reserve", img: "/icons3d/reserve.png" },
      ].map((t, i) => (
        <motion.div
          key={t.key}
          className="hub-tile-cell"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: i * 0.06 }}
        >
          <Link to={t.to} className="hub-tile" aria-label={t.label}>
            <motion.span layoutId={`nav-icon-${t.key}`} className="hub-tile-icon" aria-hidden="true">
              <img src={t.img} alt="" />
            </motion.span>
            <span className="hub-tile-label">{t.label}</span>
          </Link>
        </motion.div>
      ))}
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
          {/* Shared-element morph destination for the home hub's Events tile
              (see the layoutId="nav-icon-events" tile in the embedded render
              above) — Framer Motion animates the tapped tile's icon into this
              slot across the route change, so it visually "merges into the
              top" of this page instead of just appearing. */}
          <motion.span layoutId="nav-icon-events" className="ex-hero-nav-icon" aria-hidden="true">🎟️</motion.span>
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

      {/* Embedded home: search + niche tiles live in a sticky glass header
          (see .home-topstick — pins to the top and frosts once scrolled).
          Standalone Events page keeps them flat with the filter chips. */}
      {embedded ? (
        <>
          <div ref={stickSentinelRef} className="topstick-sentinel" aria-hidden="true" />
          <div className={"home-topstick" + (stuck ? " stuck" : "")}>
            {searchBlock}
            {recentBlock}
            {hubBlock}
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

      {loading && (
        <div className="ex-list">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
        </div>
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
            {S.heroPool.length > 0 && (
              <section className="ex-section ex-section-spotlight">
                <div className="ex-head">
                  <h2>In the spotlight</h2>
                </div>
                <FeaturedSpotlight events={S.heroPool} />
              </section>
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
            {S.rest.length > 0 && (
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
