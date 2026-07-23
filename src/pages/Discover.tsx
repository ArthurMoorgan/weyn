import { Link } from "react-router-dom";
import Explore from "./Explore";
import UserAvatar from "../components/UserAvatar";
import AiDiamondMark from "../components/AiDiamondMark";
import { useAccount } from "../store";

// Home hub header: the Events/Venues segmented toggle (real navigation
// between the two existing routes, not an in-page mode switch — Reservations
// keeping its own route/mount lifecycle is a deliberate, separate decision;
// see App.tsx's MAIN_TABS comment) + AI + the profile avatar. Reuses the
// `.seg-toggle`/`.seg-btn`/`.seg-toggle-thumb` component already built and
// tuned in components.css — Explore.tsx and Reservations.tsx have both
// referenced "the Discover shell's segmented toggle" in their own comments
// for a while, this just actually renders it again. City/location switching
// moved off this row (not in the reference) — still reachable from the You
// tab and the desktop top bar. AI moved here from the bottom nav per direct
// instruction — "the entry point lives once, at the top," same reasoning
// this file already applied to Profile (see App.tsx's comment on it).
export default function Discover() {
  const account = useAccount();
  return (
    <>
      <div className="discover-head">
        <div className="seg-toggle">
          <span className="seg-toggle-thumb" />
          <Link to="/" className="seg-btn on">Events</Link>
          <Link to="/venues" className="seg-btn">Venues</Link>
        </div>
        <div className="discover-head-actions">
          <Link to="/concierge" className="discover-head-icon-btn" aria-label="AI concierge">
            <AiDiamondMark className="discover-head-ai-mark" />
          </Link>
          <UserAvatar account={account} />
        </div>
      </div>

      <Explore embedded />
    </>
  );
}
