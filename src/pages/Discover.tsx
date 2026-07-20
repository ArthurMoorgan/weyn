import Explore from "./Explore";
import CityPill from "../components/CityPill";

// Home hub: a clean location header + search + the 2-tile nav grid (Events /
// Reserve — see Explore's embedded render). Persistent navigation (Home,
// Reserve, AI, Tickets, Profile) lives in the floating MobileDock, so the
// header no longer carries saved/tickets/profile shortcuts. Reserve is a real
// pushed route reached by tapping its tile with a shared-element icon morph
// (see the layoutId props in Explore.tsx / Reservations.tsx).
export default function Discover() {
  return (
    <>
      <div className="discover-head">
        <CityPill variant="home" />
      </div>

      <Explore embedded />
    </>
  );
}
