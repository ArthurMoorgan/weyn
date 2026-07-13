import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

// The nav+content grid (.organizer-shell / .profile-tabs.organizer-nav /
// .organizer-content) was copy-pasted three times — organizer/Layout.tsx,
// organizer/EventWorkspace.tsx, and venue-os/Workspace.tsx each reimplemented
// the identical markup with their own tab lists. Extracted here so it's one
// implementation; the CSS contract (.organizer-shell etc) is unchanged so no
// stylesheet rewrite was needed for this to be a drop-in swap. Deliberately
// scoped to just the nav+content chrome, not each page's differing header
// row above it (Layout's full topbar vs EventWorkspace/Workspace's lighter
// back+title row) — those stay page-specific.
export interface DashboardShellNavItem {
  to: string;
  icon: string;
  label: string;
  /** Passed straight through to NavLink's own `end` matching. */
  end?: boolean;
  /**
   * Overrides NavLink's own route-match active state. Needed by callers
   * that derive the active tab from a route param they already have
   * (e.g. a `:tab` param used for a redirect-when-missing check) rather
   * than letting NavLink re-derive it from the URL.
   */
  active?: boolean;
}

export default function DashboardShell({
  navItems,
  ariaLabel,
  children,
}: {
  navItems: DashboardShellNavItem[];
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="organizer-shell">
      <nav className="profile-tabs organizer-nav" aria-label={ariaLabel}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => "profile-tab" + ((item.active ?? isActive) ? " on" : "")}
          >
            <i className={`icon-${item.icon}`} /> {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="organizer-content">{children}</div>
    </div>
  );
}
