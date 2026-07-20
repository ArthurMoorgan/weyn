import { Link } from "react-router-dom";
import Explore from "./Explore";
import CityPill from "../components/CityPill";
import UserAvatar from "../components/UserAvatar";
import { useAccount } from "../store";

// Home hub: a clean location header (location left; Tickets + Profile in a
// glassy top strip right) + search + the 2-tile nav grid (Events / Reserve —
// see Explore's embedded render). The AI concierge is the floating orb (see
// App.tsx); on scroll the tiles collapse into an "Ask AI · Events · Reserve"
// glass bar (see .home-collapsed-nav in Explore.tsx).
export default function Discover() {
  const account = useAccount();
  return (
    <>
      <div className="discover-head">
        <CityPill variant="home" />
        <div className="discover-head-actions">
          <Link to="/tickets" className="glass-icon-btn" aria-label="Tickets">
            <i className="icon-ticket" />
          </Link>
          <UserAvatar account={account} />
        </div>
      </div>

      <Explore embedded />
    </>
  );
}
