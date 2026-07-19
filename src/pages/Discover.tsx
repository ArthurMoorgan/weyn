import { Link } from "react-router-dom";
import Explore from "./Explore";
import UserAvatar from "../components/UserAvatar";
import CityPill from "../components/CityPill";
import { useAccount } from "../store";

// Home hub: search + the 3-tile nav grid (Events/Venues/Host — see Explore's
// embedded render) + a persistent top strip (location, saved, tickets,
// profile). Venues and Host are real pushed routes now, reached by tapping a
// tile with a shared-element icon morph (see the layoutId props in
// Explore.tsx / Reservations.tsx / Organizer.tsx) — Discover itself no longer
// has an Events/Venues mode to switch between.
export default function Discover() {
  const account = useAccount();

  return (
    <>
      <div className="discover-head">
        <CityPill />
        <div className="discover-head-actions">
          <Link to="/saved" className="discover-head-icon-btn" aria-label="Saved">
            <i className="icon-bookmark" />
          </Link>
          <Link to="/tickets" className="discover-head-icon-btn" aria-label="My tickets">
            <i className="icon-ticket" />
          </Link>
          <UserAvatar account={account} />
        </div>
      </div>

      <Explore embedded />
    </>
  );
}
