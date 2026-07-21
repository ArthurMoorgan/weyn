import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Sticky top bar for pushed pages. Pages reached only by drilling in from
// somewhere else (Saved, Host, Admin, …) get a back-to-home control on the
// left; the page's own action (usually the avatar) sits on the right. Pass
// `back={false}` for anything that's actually a bottom-tab destination
// (Tickets, the AI concierge) — those are peers of Discover, reachable
// directly from the bar, so a "back" arrow there is a redundant affordance
// that used to make sense only when the mobile bottom bar didn't exist.
export default function PageTopBar({ children, back = true }: { children?: ReactNode; back?: boolean }) {
  return (
    <div className="page-top-bar">
      {back ? (
        <Link to="/" className="page-top-back" aria-label="Back to home">
          <i className="icon-arrow-left" />
        </Link>
      ) : <span />}
      {children}
    </div>
  );
}
