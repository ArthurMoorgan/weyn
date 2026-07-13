import { useState, type ReactNode } from "react";
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

function NavItem({ item }: { item: DashboardShellNavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => "profile-tab" + ((item.active ?? isActive) ? " on" : "")}
    >
      <i className={`icon-${item.icon}`} /> {item.label}
    </NavLink>
  );
}

export default function DashboardShell({
  navItems,
  ariaLabel,
  children,
  primary,
}: {
  navItems: DashboardShellNavItem[];
  ariaLabel: string;
  children: ReactNode;
  /**
   * Top-level section nav (e.g. organizer/Layout.tsx's 7 sections) gets a
   * mobile-only floating "primary 4 + More" treatment (per the Editorial
   * handoff's mobile organizer nav) without dropping any real sections —
   * the rest stay one tap away in the More popover. Desktop is unaffected
   * (full sidebar, unchanged). Workspace sub-navs (per-event/per-venue tabs)
   * don't pass this — they keep the existing horizontal-scroll strip.
   */
  primary?: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryItems = navItems.slice(0, 4);
  const moreItems = navItems.slice(4);

  return (
    <div className="organizer-shell">
      {primary && (
        <div className="organizer-nav-compact">
          <nav className="organizer-nav-primary" aria-label={ariaLabel}>
            {primaryItems.map((item) => <NavItem key={item.to} item={item} />)}
          </nav>
          {moreItems.length > 0 && (
            <div className="organizer-more">
              <button
                type="button"
                className={"organizer-more-btn" + (moreOpen ? " on" : "")}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label="More sections"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <i className="icon-more-horizontal" />
              </button>
              {moreOpen && (
                <div className="organizer-more-menu" role="menu">
                  {moreItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      role="menuitem"
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => "tab-host-item" + ((item.active ?? isActive) ? " on" : "")}
                    >
                      <i className={`icon-${item.icon}`} /> <strong>{item.label}</strong>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <nav className={"profile-tabs organizer-nav" + (primary ? " organizer-nav-desktop-only" : "")} aria-label={ariaLabel}>
        {navItems.map((item) => <NavItem key={item.to} item={item} />)}
      </nav>
      <div className="organizer-content">{children}</div>
    </div>
  );
}
