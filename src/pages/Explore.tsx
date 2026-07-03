import { useMemo, useState } from "react";
import { api, CATS, type Cat, groupKey, isTonight, isThisWeekend } from "../api";
import { useAsync } from "../hooks";
import Stub from "../components/Stub";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

type TimeFilter = "all" | "tonight" | "weekend";
const GROUP_ORDER = ["Today", "Tomorrow", "This week", "Next week", "Later"];
const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: "tonight", label: "Tonight" },
  { key: "weekend", label: "This weekend" },
];

export default function Explore() {
  const [cat, setCat] = useState<Cat | "all">("all");
  const [tf, setTf] = useState<TimeFilter>("all");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.listEvents({ cat, q }), [cat, q]);
  const searching = q.trim().length > 0;

  const groups = useMemo(() => {
    let list = data || [];
    if (tf === "tonight") list = list.filter(isTonight);
    if (tf === "weekend") list = list.filter(isThisWeekend);
    const by: Record<string, typeof list> = {};
    for (const e of list) (by[groupKey(e)] ||= []).push(e);
    return GROUP_ORDER.filter((g) => by[g]?.length).map((g) => [g, by[g]] as const);
  }, [data, tf]);

  const total = groups.reduce((s, [, l]) => s + l.length, 0);

  return (
    <>
      <header className="topbar">
        <Logo wordmark size={26} />
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="ti ti-map-pin" /> Muscat</span>
        </div>
      </header>

      <div className="search" style={{ marginTop: 10 }}>
        <i className="ti ti-search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, venues, tags…" />
        {q && <button className="clearx" onClick={() => setQ("")} aria-label="Clear"><i className="ti ti-x" /></button>}
      </div>

      {/* Time filters and categories share ONE scrollable row instead of
          three separate chrome tiers (title/segment/chips) — events start
          appearing much sooner on screen; discovery first, controls second. */}
      {!searching && (
        <div className="chips compact">
          {TIME_FILTERS.map((t) => (
            <button key={t.key} className={"chip" + (tf === t.key ? " on" : "")} onClick={() => setTf(tf === t.key ? "all" : t.key)}>
              {t.label}
            </button>
          ))}
          <span className="chip-divider" />
          {CATS.map((c) => (
            <button key={c.key} className={"chip" + (cat === c.key ? " on" : "")} onClick={() => setCat(c.key as Cat | "all")}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="feed">
          {[0, 1, 2].map((i) => <div key={i} className="skel"><div className="a" /><div className="b" /></div>)}
        </div>
      )}

      {error && (
        <div className="empty">
          <div className="ic"><i className="ti ti-cloud-off" /></div>
          <p>Couldn't load events. {error}</p>
          <button className="btn glass" style={{ maxWidth: 200, margin: "0 auto" }} onClick={reload}>Try again</button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="empty">
          <div className="ic"><i className={"ti " + (searching ? "ti-search-off" : "ti-calendar-off")} /></div>
          <p>{searching ? `No matches for "${q}".` : "Nothing matches that filter. Try \"All upcoming\" or another category."}</p>
        </div>
      )}

      {!loading && !error && searching && total > 0 && (
        <div className="feed" style={{ paddingTop: 8 }}>{groups.flatMap(([, l]) => l).map((e) => <Stub key={e.id} e={e} />)}</div>
      )}

      {!loading && !error && !searching && groups.map(([label, list]) => (
        <section key={label}>
          <div className="date-head"><h2>{label}</h2><span>{list.length} {list.length === 1 ? "event" : "events"}</span></div>
          <div className="feed">{list.map((e) => <Stub key={e.id} e={e} />)}</div>
        </section>
      ))}
    </>
  );
}
