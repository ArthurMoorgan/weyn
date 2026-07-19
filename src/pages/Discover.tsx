import { lazy, Suspense, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Explore from "./Explore";
import Skeleton from "../components/Skeleton";
import UserAvatar from "../components/UserAvatar";
import CityPill from "../components/CityPill";
import { useAccount } from "../store";

// Events and Venues are now two separate bottom-tab destinations (App.tsx
// TABS), not a segmented toggle inside one screen. Discover is the shared
// shell both tabs render — the `mode` prop (set per-tab in App.MAIN_TABS)
// decides which browse surface mounts. The old in-header Events/Venues
// toggle, the "Host →" redirect, and the "Ask AI" icon were all removed from
// the top: Host and the AI helper now live in the bottom taskbar, so the
// header is just location + profile, matching the reference's clean top row.
const Reservations = lazy(() => import("./Reservations"));

export default function Discover({ mode = "events" }: { mode?: "events" | "venues" }) {
  const account = useAccount();
  const location = useLocation();
  const activePath = mode === "venues" ? "/venues" : "/";

  // Re-hue .shell's ambient glow to match the active browse surface — only
  // the instance whose route is actually on screen touches it, so the two
  // mounted Discover instances (/ and /venues) don't fight over the glow.
  useEffect(() => {
    if (location.pathname !== activePath) return;
    const shell = document.querySelector(".shell");
    shell?.setAttribute("data-ambient", mode);
    return () => shell?.removeAttribute("data-ambient");
  }, [mode, location.pathname, activePath]);

  return (
    <>
      <div className="discover-head">
        {/* Venues is a pushed destination (reached from the home hub's Venues
            tile), so it gets a back-to-home control in place of the location
            pill — without a bottom bar there'd otherwise be no way back. */}
        {mode === "venues" ? (
          <Link to="/" className="discover-head-back" aria-label="Back to home">
            <i className="icon-arrow-left" /> <span>Venues</span>
          </Link>
        ) : (
          <CityPill />
        )}
        <div className="discover-head-actions">
          {/* Persistent top strip — with the bottom tab bar gone, these are
              the always-one-tap essentials: saved, tickets, profile. */}
          <Link to="/saved" className="discover-head-icon-btn" aria-label="Saved">
            <i className="icon-bookmark" />
          </Link>
          <Link to="/tickets" className="discover-head-icon-btn" aria-label="My tickets">
            <i className="icon-ticket" />
          </Link>
          <UserAvatar account={account} />
        </div>
      </div>

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
