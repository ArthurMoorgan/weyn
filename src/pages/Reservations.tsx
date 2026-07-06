import { useEffect, useMemo, useRef, useState } from "react";
import { api, VENUE_CATS, type Venue, type VenueCategory } from "../api";
import VenueCard from "../components/VenueCard";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import CityPill from "../components/CityPill";

// Reservations mirrors Explore's browse pattern (topbar → search → chips →
// grid/list → loading/empty states) but for venues instead of events, and
// paginates via "Load more" rather than Explore's single full-list fetch —
// the venues endpoint is paged server-side (page/limit/total/totalPages).
const PAGE_SIZE = 20;

// Venue has no real popularity signal (no bookings/sold count exposed to the
// client) — `verified` is the only trust/quality flag that exists, so
// "Trending" here is a documented proxy: verified venues first, then newest
// (createdAt desc, which is also how the server already orders /api/venues).
function byTrendingProxy(a: Venue, b: Venue): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

// haversine distance in km — used only for the client-side "Near You" sort,
// mirrors the kind of distanceKm the events API already computes server-side
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function Reservations() {
  const [cat, setCat] = useState<VenueCategory | "all">("all");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "asking" | "granted" | "denied">("idle");

  // "Near You" — same permission pattern as Onboarding.tsx's requestLocation:
  // ask once, never block or error the page if denied/unsupported, just skip
  // the section gracefully.
  useEffect(() => {
    if (!("geolocation" in navigator)) { setGeoState("denied"); return; }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoState("granted"); },
      () => setGeoState("denied"),
      { timeout: 8000 }
    );
  }, []);

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // reset + fetch page 1 whenever filters change
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    api.listVenues({ category: cat, q: qDebounced, page: 1, limit: PAGE_SIZE })
      .then((res) => {
        if (id !== reqId.current) return;
        setVenues(res.venues);
        setPage(res.page);
        setTotalPages(res.totalPages);
        setTotal(res.total);
      })
      .catch((e) => { if (id === reqId.current) setError(e.message || "Something went wrong"); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [cat, qDebounced]);

  async function loadMore() {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      const res = await api.listVenues({ category: cat, q: qDebounced, page: page + 1, limit: PAGE_SIZE });
      setVenues((v) => [...v, ...res.venues]);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message || "Couldn't load more venues");
    } finally {
      setLoadingMore(false);
    }
  }

  const hasMore = page < totalPages;
  const searching = qDebounced.length > 0;
  const browsing = !searching && cat === "all" && page === 1;

  // Trending/Near You are derived from the current page-1 `venues` list only
  // (no extra endpoint) — same "one fetch, many sections" approach Explore
  // uses, just scoped to what's already loaded rather than a full dataset.
  const trending = useMemo(
    () => (browsing ? [...venues].sort(byTrendingProxy).slice(0, 10) : []),
    [venues, browsing]
  );
  const nearYou = useMemo(() => {
    if (!browsing || !coords) return [];
    return [...venues]
      .filter((v) => typeof v.lat === "number" && typeof v.lng === "number")
      .sort((a, b) => distanceKm(coords.lat, coords.lng, a.lat, a.lng) - distanceKm(coords.lat, coords.lng, b.lat, b.lng))
      .slice(0, 10);
  }, [venues, browsing, coords]);
  const emptyLabel = useMemo(() => {
    if (searching) return `No venues matching "${qDebounced}".`;
    if (cat !== "all") return "No venues found in this category yet.";
    return "No venues available yet.";
  }, [searching, qDebounced, cat]);

  return (
    <>
      <header className="topbar">
        <Logo wordmark size={26} />
        <div className="tb-right">
          <ThemeToggle />
          <CityPill />
        </div>
      </header>

      <section className="ex-hero">
        <h1>Reserve a table</h1>
      </section>

      <div className="search-wrap">
        <div className="search">
          <i className="icon-search" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search venues, areas, tags…"
          />
          {q && <button className="clearx" onClick={() => setQ("")} aria-label="Clear"><i className="icon-x" /></button>}
        </div>
      </div>

      <div className="chips">
        {VENUE_CATS.map((c) => (
          <button key={c.key} className={"chip" + (cat === c.key ? " on" : "")} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="ex-rail dense" style={{ padding: "0 16px" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="empty">
          <div className="ic"><i className="icon-cloud-off" /></div>
          <p>Couldn't load venues. {error}</p>
        </div>
      )}

      {!loading && !error && venues.length === 0 && (
        <div className="empty">
          <div className="ic"><i className="icon-map-pin-off" /></div>
          <p>{emptyLabel}</p>
        </div>
      )}

      {!loading && !error && browsing && trending.length > 0 && (
        <section className="ex-section">
          <div className="ex-head"><h2>Trending</h2><span className="ex-sub">Verified &amp; newest first</span></div>
          <div className="ex-rail dense">
            {trending.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
        </section>
      )}

      {!loading && !error && browsing && geoState === "granted" && nearYou.length > 0 && (
        <section className="ex-section">
          <div className="ex-head"><h2>Near you</h2></div>
          <div className="ex-rail dense">
            {nearYou.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
        </section>
      )}

      {!loading && !error && venues.length > 0 && (
        <section className="ex-section">
          <div className="ex-head"><h2>Venues</h2><span className="ex-sub">{total} found</span></div>
          <div className="ex-rail dense">
            {venues.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
          {hasMore && (
            <div style={{ padding: "16px" }}>
              <button className="btn glass" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
