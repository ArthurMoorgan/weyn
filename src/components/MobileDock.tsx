import { useLocation } from "react-router-dom";
import { MotionNavLink, MotionLink } from "../motion";
import { useAccount } from "../store";

// Mobile-only floating nav (hidden >=900px, where .tabs becomes a top bar).
// A pill-shaped glass bar that stays put across every route, with the AI
// concierge as a raised, glowing orb in the center — the one persistent way
// to reach the assistant, and the home for the "what's on / what I've got /
// who I am" destinations so drilled-in pages always have a way back out.
// Four flat tabs flank the orb: Home · Reserve · [AI] · Tickets · Profile.
const DOCK_TABS_LEFT = [
  { to: "/", end: true, icon: "home", label: "Home" },
  { to: "/venues", icon: "store", filled: true, label: "Reserve" },
];
const DOCK_TABS_RIGHT = [
  { to: "/tickets", icon: "ticket", filled: true, label: "Tickets" },
];

function DockTab({ to, end, icon, filled, label }: { to: string; end?: boolean; icon: string; filled?: boolean; label: string }) {
  return (
    <MotionNavLink
      to={to}
      end={end}
      className={({ isActive }) => "dock-item" + (isActive ? " on" : "")}
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <i className={"icon-" + icon + (isActive && filled ? "-fill" : "")} />
          <span className="dock-item-label">{label}</span>
        </>
      )}
    </MotionNavLink>
  );
}

export default function MobileDock() {
  const account = useAccount();
  const location = useLocation();
  const profileActive = location.pathname === "/you";

  return (
    <nav className="dock" aria-label="Primary">
      {DOCK_TABS_LEFT.map((t) => <DockTab key={t.to} {...t} />)}

      {/* AI concierge — the raised center orb. A real gradient purple (the
          one sanctioned hue) so it reads as the app's single "magic" moment,
          gently breathing (CSS, reduced-motion-guarded) to invite a tap. */}
      <div className="dock-ai">
        <MotionLink to="/concierge" className="dock-ai-orb" aria-label="Ask the AI">
          <i className="icon-sparkles" />
        </MotionLink>
      </div>

      {DOCK_TABS_RIGHT.map((t) => <DockTab key={t.to} {...t} />)}

      {/* Profile: the account avatar itself when signed in, a glyph otherwise. */}
      <MotionLink
        to="/you"
        className={"dock-item dock-item-profile" + (profileActive ? " on" : "")}
        aria-label="Profile"
      >
        <span className="dock-avatar">
          {account?.picture ? <img src={account.picture} alt="" /> : <i className="icon-circle-user" />}
        </span>
        <span className="dock-item-label">Profile</span>
      </MotionLink>
    </nav>
  );
}
