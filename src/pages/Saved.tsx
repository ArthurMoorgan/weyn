import { Link } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { useSaved } from "../store";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";

export default function Saved() {
  const saved = useSaved();
  const { data, loading } = useAsync(() => api.listEvents(), []);
  const list = (data || []).filter((e) => saved.includes(e.id));

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Saved</span></div>
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="ti ti-heart" /> {saved.length}</span>
        </div>
      </header>

      <div className="page-head">
        <h1>Your saved events</h1>
        <p className="sub">{saved.length === 0 ? "Nothing here yet" : `${list.length} saved`}</p>
      </div>

      {loading && <div className="spin" />}

      {!loading && (list.length > 0 ? (
        <div className="feed" style={{ paddingTop: 8 }}>{list.map((e) => <Stub key={e.id} e={e} />)}</div>
      ) : (
        <div className="empty">
          <div className="ic"><i className="ti ti-heart" /></div>
          <p><b style={{ color: "var(--text)" }}>Nothing saved yet.</b><br />Tap the heart on any event to keep it here for later.</p>
          <Link to="/" className="btn" style={{ maxWidth: 240, margin: "0 auto" }}>
            <i className="ti ti-compass" /> Explore events
          </Link>
        </div>
      ))}
    </>
  );
}
