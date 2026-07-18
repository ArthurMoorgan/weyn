import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import Explore from "./Explore";
import Skeleton from "../components/Skeleton";
import PageTopBar from "../components/PageTopBar";
import UserAvatar from "../components/UserAvatar";
import Tooltip from "../components/Tooltip";
import { useAccount } from "../store";

// Reservations (venue browsing) is now folded into Discover as a second
// mode rather than living on its own bottom-tab slot — events and venues
// are the same "what's on near me" intent, so switching between them is a
// segmented toggle at the top, not a separate destination. Reservations
// stays lazy: a visitor who never flips to Venues never downloads it.
const Reservations = lazy(() => import("./Reservations"));

export default function Discover() {
  const [mode, setMode] = useState<"events" | "venues">("events");
  const account = useAccount();

  return (
    <>
      <PageTopBar>
        <Tooltip text="Saved">
          <Link to="/saved" className="page-top-bar-icon-btn" aria-label="Saved">
            <i className="icon-bookmark" />
          </Link>
        </Tooltip>
        <UserAvatar account={account} />
      </PageTopBar>

      <div className="discover-head">
        <div className="seg-toggle" role="tablist" aria-label="Browse">
          {/* Sliding thumb — a single element that transforms between the
              two slot positions, rather than each button re-painting its
              own background on click, is what actually reads as "sliding"
              instead of an instant color swap. */}
          <div className={"seg-toggle-thumb" + (mode === "venues" ? " slot-2" : "")} aria-hidden="true" />
          <button
            role="tab"
            aria-selected={mode === "events"}
            className={"seg-btn seg-btn-events" + (mode === "events" ? " on" : "")}
            onClick={() => setMode("events")}
          >
            Events
          </button>
          <button
            role="tab"
            aria-selected={mode === "venues"}
            className={"seg-btn seg-btn-venues" + (mode === "venues" ? " on" : "")}
            onClick={() => setMode("venues")}
          >
            Venues
          </button>
        </div>
        <div className="discover-head-actions">
          <Link to="/concierge" className="ex-hero-link">Ask our AI</Link>
          <Link to="/host/events" className="ex-hero-host">Host <i className="icon-arrow-right" /></Link>
        </div>
      </div>

      {/* key={mode} + .discover-mode's rise-in animation (same entrance
          motion as feed cards elsewhere) gives the Events/Venues content
          swap a real transition instead of an instant hard cut, matching
          the thumb slide above it. */}
      <div key={mode} className="discover-mode">
        {mode === "events" ? (
          <Explore embedded />
        ) : (
          <Suspense fallback={<Skeleton variant="discover" />}>
            <Reservations embedded />
          </Suspense>
        )}
      </div>
    </>
  );
}
