import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, CATS, type Cat, type Venue, isToday, isTomorrow, isThisWeekend, isPast } from "../api";
import { useAsync } from "../hooks";
import { parseSearchQuery } from "../utils/queryParser";
import ThemeToggle from "../components/ThemeToggle";
import Tooltip from "../components/Tooltip";
import Stub from "../components/Stub";

export default function Search() {
  const nav = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [showFilters, setShowFilters] = useState(false);
  const [detectedPatterns, setDetectedPatterns] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cat = (params.get("cat") || "all") as Cat | "all";
  const when = (params.get("when") || "all") as "all" | "today" | "tomorrow" | "weekend";
  const maxPrice = params.get("maxPrice") ? parseInt(params.get("maxPrice")!, 10) : null;

  const { data = [], loading } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });

  // Fetch venues when search query changes
  const { data: venuesResponse, loading: venuesLoading } = useAsync(
    () => q.trim() ? api.listVenues({ q: q.trim(), limit: 20 }) : Promise.resolve({ venues: [], page: 1, limit: 20, total: 0, totalPages: 0 }),
    [q],
    { cacheKey: `venues:${q.trim()}` }
  );

  // Auto-focus on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Update URL params with filter state
  const updateParams = (query: string, category: Cat | "all", whenVal: "all" | "today" | "tomorrow" | "weekend", maxPriceVal: number | null) => {
    const newParams: Record<string, string> = {};
    if (query.trim()) newParams.q = query;
    if (category !== "all") newParams.cat = category;
    if (whenVal !== "all") newParams.when = whenVal;
    if (maxPriceVal !== null) newParams.maxPrice = String(maxPriceVal);
    setSearchParams(newParams, { replace: true });
  };

  // Debounce search query with pattern parsing
  const handleSearchChange = (value: string) => {
    setQ(value);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      const parsed = parseSearchQuery(value);
      const detected = new Set<string>();
      let newWhen = when;
      let newMaxPrice = maxPrice;

      if (parsed.when) {
        newWhen = parsed.when;
        detected.add(parsed.when === "today" ? "Tonight" : "This weekend");
      }
      if (parsed.maxPrice !== undefined) {
        newMaxPrice = parsed.maxPrice;
        detected.add(parsed.maxPrice === 0 ? "Free" : `Under ${parsed.maxPrice} OMR`);
      }

      setDetectedPatterns(detected);
      updateParams(value, cat, newWhen, newMaxPrice);
    }, 300);
  };

  const handleCategoryChange = (newCat: Cat | "all") => {
    updateParams(q, newCat, when, maxPrice);
  };

  const handleWhenChange = (newWhen: "all" | "today" | "tomorrow" | "weekend") => {
    updateParams(q, cat, newWhen, maxPrice);
  };

  const handlePriceChange = (value: number) => {
    const newMaxPrice = value >= priceCeiling ? null : value;
    updateParams(q, cat, when, newMaxPrice);
  };

  const handleClearAllFilters = () => {
    setQ("");
    setDetectedPatterns(new Set());
    updateParams("", "all", "all", null);
  };

  // Calculate price ceiling
  const priceCeiling = useMemo(() => {
    const max = Math.max(0, ...(data?.map((e) => e.price) || [0]));
    return Math.max(10, Math.ceil(max / 5) * 5);
  }, [data]);
  const priceValue = maxPrice ?? priceCeiling;

  // Count active filters
  const activeFilterCount = (when !== "all" ? 1 : 0) + (cat !== "all" ? 1 : 0) + (maxPrice !== null ? 1 : 0);

  // Filter events
  const results = useMemo(() => {
    if (!data) return [];
    const all = data.filter((e) => !e.cancelled && !isPast(e));
    const priceFiltered = maxPrice === null ? all : all.filter((e) => e.price <= maxPrice);
    const catFiltered = cat === "all" ? priceFiltered : priceFiltered.filter((e) => e.cat === cat);

    if (when !== "all") {
      const pred = when === "today" ? isToday : when === "tomorrow" ? isTomorrow : isThisWeekend;
      return catFiltered.filter(pred);
    }

    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return catFiltered.filter((e) => {
        const catLabel = CATS.find((c) => c.key === e.cat)?.label || e.cat;
        return (e.title + " " + e.organizer + " " + e.area + " " + (e.venue || "") + " " + catLabel + " " + (e.tags || []).join(" "))
          .toLowerCase()
          .includes(t);
      });
    }

    return catFiltered;
  }, [data, q, cat, when, maxPrice]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  // Simple venue card component — reuses event card styling
  const VenueCard = ({ venue }: { venue: Venue }) => (
    <a href={`/v/${venue.id}`} className="ec-row" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="ec-thumb" style={{
        backgroundImage: venue.coverImage ? `url(${venue.coverImage})` : `linear-gradient(150deg, var(--cat-food, #3A3A3A), var(--fallback-scrim))`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }} />
      <div className="ec-main">
        <div className="ec-top">
          <span className="ec-when">{venue.area}</span>
          {venue.verified && <span className="ec-badge" style={{ fontSize: 12 }}>✓ Verified</span>}
        </div>
        <h3 className="ec-title">{venue.name}</h3>
        <div className="ec-meta">
          <span>{venue.category}</span>
          <span className="ec-dot">·</span>
          <span>{venue.priceRange || "$$"}</span>
        </div>
      </div>
    </a>
  );

  return (
    <>
      <header className="topbar">
        <Tooltip text="Back">
          <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back">
            <i className="icon-arrow-left" />
          </button>
        </Tooltip>
        <div className="brand"><span className="en">Search</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="search-wrap">
        <div className="search">
          <span className="search-icon-slot"><i className="icon-search" /></span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search events, venues, tags…"
            aria-label="Search"
          />
          {q && (
            <button className="clearx" onClick={() => { setQ(""); setDetectedPatterns(new Set()); updateParams("", cat, when, maxPrice); }} aria-label="Clear">
              <i className="icon-x" />
            </button>
          )}
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
        {detectedPatterns.size > 0 && (
          <div className="chips" style={{ padding: "12px 16px 0" }}>
            {Array.from(detectedPatterns).map((pattern) => (
              <span key={pattern} className="chip" style={{ fontSize: 12 }}>
                {pattern}
              </span>
            ))}
          </div>
        )}
      </div>

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
                  <button key={w} className={"chip" + (when === w ? " on" : "")} onClick={() => handleWhenChange(w)}>
                    {w === "all" ? "Any time" : w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "This weekend"}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-sheet-group">
              <span className="filter-sheet-label">Category</span>
              <div className="chips">
                {CATS.map((c) => (
                  <button key={c.key} className={"chip" + (cat === c.key ? " on" : "")} onClick={() => handleCategoryChange(c.key as Cat | "all")}>
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
                onChange={(e) => handlePriceChange(Number(e.target.value))}
                aria-label="Maximum price"
              />
            </div>

            <div className="filter-sheet-actions">
              <button className="btn glass" onClick={handleClearAllFilters}>Clear all</button>
              <button className="btn lg" onClick={() => setShowFilters(false)}>Show results</button>
            </div>
          </div>
        </div>
      )}

      <section style={{ padding: "16px 16px 32px" }}>
        {loading ? (
          <div className="ex-list">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
          </div>
        ) : results.length > 0 ? (
          <div className="ex-list">
            {results.map((e) => <Stub key={e.id} e={e} />)}
          </div>
        ) : q.trim() ? (
          <div className="empty"><div className="ic"><i className="icon-search-x" /></div><p>No matches for "{q}".</p></div>
        ) : (
          <div className="empty"><div className="ic"><i className="icon-search" /></div><p>Search for events to get started.</p></div>
        )}
      </section>

      {q.trim() && venuesResponse?.venues && venuesResponse.venues.length > 0 && (
        <section style={{ padding: "0 0 32px 0" }}>
          <div className="date-head" style={{ padding: "12px 16px 8px" }}>
            <h2>Restaurants & Venues</h2>
            <span className="ex-sub">{venuesResponse.venues.length} found</span>
          </div>
          {venuesLoading ? (
            <div className="ex-list">
              {[0, 1, 2].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
            </div>
          ) : (
            <div className="ex-list">
              {venuesResponse.venues.map((v) => <VenueCard key={v.id} venue={v} />)}
            </div>
          )}
        </section>
      )}
    </>
  );
}
