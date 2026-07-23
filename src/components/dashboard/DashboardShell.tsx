import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { settleSpring } from "../../motion";
import Logo from "../Logo";
import { DASHBOARD_GROUPS } from "../../lib/dashboardGroups";

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
  /** Semantic group for tab organization — see DASHBOARD_GROUPS for the canonical set. */
  group?: string;
}

// `indicatorId` is the layoutId the sliding active-pill shares — items in the
// same nav strip pass the same id so the pill morphs between them. The desktop
// sidebar and the mobile compact strip (both rendered by the `primary` variant)
// get different ids so their two pills don't fight over one shared layoutId
// while both are in the DOM. MotionConfig's reducedMotion="user" disables the
// layout animation, so the pill just snaps into place when motion is reduced.
function NavItem({ item, indicatorId }: { item: DashboardShellNavItem; indicatorId: string }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => "profile-tab" + ((item.active ?? isActive) ? " on" : "")}
    >
      {({ isActive }) => (
        <>
          {(item.active ?? isActive) && (
            <motion.span layoutId={indicatorId} className="dash-nav-indicator" transition={settleSpring} />
          )}
          <span className="dash-nav-label"><i className={`icon-${item.icon}`} /> {item.label}</span>
        </>
      )}
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

  // Group nav items if any have a group property. Order follows
  // DASHBOARD_GROUPS (the one taxonomy shared by organizer/event/venue);
  // any item whose group isn't one of those keys still renders, bucketed
  // under "Other" at the end, rather than silently vanishing.
  const hasGroups = navItems.some((item) => item.group);
  const knownGroups = Object.keys(DASHBOARD_GROUPS);
  const groupedItems = hasGroups
    ? (() => {
        const acc: Record<string, DashboardShellNavItem[]> = {};
        for (const groupName of knownGroups) {
          const items = navItems.filter((item) => item.group === groupName);
          if (items.length > 0) acc[groupName] = items;
        }
        const rest = navItems.filter((item) => item.group && !knownGroups.includes(item.group));
        if (rest.length > 0) acc.other = rest;
        return acc;
      })()
    : null;

  const groupLabel = (groupName: string) => (DASHBOARD_GROUPS as Record<string, string>)[groupName] ?? "Other";

  // Auto-expand groups containing active items; default to 'operations' if none active
  const getInitialExpandedGroups = (): Set<string> => {
    if (!groupedItems) return new Set();
    const groupsWithActive = Object.entries(groupedItems)
      .filter(([, items]) => items.some((item) => item.active === true))
      .map(([groupName]) => groupName);
    return groupsWithActive.length > 0 ? new Set(groupsWithActive) : new Set(["operations"]);
  };

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(getInitialExpandedGroups());

  // getInitialExpandedGroups() above only runs once, at mount — but this
  // component persists across tab/route changes (React Router doesn't
  // remount it for a :tab/:id param-only navigation within the same route
  // element, e.g. EventWorkspace.tsx switching tabs). Without this, a caller
  // that derives `active` from its own route param (per the JSDoc above)
  // could navigate straight into a tab whose group was never expanded,
  // leaving the mobile accordion collapsed with no visible active-tab
  // indicator at all. Re-derive whenever the active item changes and expand
  // that group — merges into the existing set (doesn't collapse anything the
  // user already opened) and no-ops if the active group is already expanded,
  // so this never fights a user's manual toggle.
  useEffect(() => {
    if (!groupedItems) return;
    const groupsWithActive = Object.entries(groupedItems)
      .filter(([, items]) => items.some((item) => item.active === true))
      .map(([groupName]) => groupName);
    if (groupsWithActive.length === 0) return;
    setExpandedGroups((prev) => {
      const missing = groupsWithActive.filter((g) => !prev.has(g));
      if (missing.length === 0) return prev;
      return new Set([...prev, ...missing]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(navItems.map((i) => [i.to, i.active]))]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  const handleGroupKeyDown = (e: React.KeyboardEvent, groupName: string) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleGroup(groupName);
    }
  };

  // The desktop section nav — grouped when items carry a `group`, flat
  // otherwise. Extracted so the `primary` variant can nest it inside a single
  // .organizer-sidebar grid child (brand + nav as one panel), which is also
  // what keeps the 2-col desktop grid from mis-placing three children into
  // two columns.
  const desktopNav = (
    <nav className={"profile-tabs organizer-nav organizer-nav-desktop" + ((primary || hasGroups) ? " organizer-nav-desktop-only" : "")} aria-label={ariaLabel}>
      {groupedItems
        ? Object.entries(groupedItems).map(([groupName, groupItems], index) => (
            <div key={groupName} className="dash-group-desktop" data-group={groupName}>
              {index > 0 && <span className="dash-group-desktop-label">{groupLabel(groupName)}</span>}
              {groupItems.map((item) => <NavItem key={item.to} item={item} indicatorId="dash-nav-indicator" />)}
            </div>
          ))
        : navItems.map((item) => <NavItem key={item.to} item={item} indicatorId="dash-nav-indicator" />)}
    </nav>
  );

  return (
    <div className={"organizer-shell" + (primary ? " organizer-shell-primary" : "")}>
      {primary && (
        <div className="organizer-nav-compact">
          <nav className="organizer-nav-primary" aria-label={ariaLabel}>
            {primaryItems.map((item) => <NavItem key={item.to} item={item} indicatorId="dash-nav-indicator-compact" />)}
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
      {/* Desktop: brand lockup + section nav as one sticky sidebar panel.
          Hidden below 900px (the `primary` compact strip above takes over).
          Wrapping brand + nav in a single element also keeps the 2-col
          desktop grid to exactly two children (sidebar, content). */}
      {primary ? (
        <aside className="organizer-sidebar organizer-nav-desktop-only">
          <div className="organizer-sidebar-brand">
            <Logo size={22} />
            <span className="organizer-sidebar-brand-caption">For business</span>
          </div>
          {desktopNav}
        </aside>
      ) : (
        desktopNav
      )}

      {/* Mobile: grouped, collapsible tabs — but only for workspace sub-navs
          (per-event/per-venue). `primary` top-level navs already have their
          own mobile treatment above (the 4 + More strip); rendering both
          here too would duplicate the nav on small screens. */}
      {hasGroups && groupedItems && !primary && (
        <nav className="organizer-nav organizer-nav-mobile" aria-label={ariaLabel}>
          {Object.entries(groupedItems).map(([groupName, groupItems]) => (
            <div key={groupName} className="dash-group">
              <button
                type="button"
                className="dash-group-header"
                aria-expanded={expandedGroups.has(groupName)}
                onClick={() => toggleGroup(groupName)}
                onKeyDown={(e) => handleGroupKeyDown(e, groupName)}
              >
                <span className="dash-group-title">{groupLabel(groupName)}</span>
                <i className={`icon-chevron-down dash-group-chevron${expandedGroups.has(groupName) ? ' expanded' : ''}`} />
              </button>
              {expandedGroups.has(groupName) && (
                <div className="dash-group-items">
                  {/* Distinct indicatorId from the desktop nav above — both are
                      simultaneously mounted (only CSS media queries hide one),
                      and two NavLinks sharing one layoutId while both are in
                      the DOM makes Framer Motion's shared-layout animation
                      measure against whichever is currently display:none,
                      producing a jumping/glitching pill on tab switches. */}
                  {groupItems.map((item) => <NavItem key={item.to} item={item} indicatorId="dash-nav-indicator-mobile-grouped" />)}
                </div>
              )}
            </div>
          ))}
        </nav>
      )}
      <div className="organizer-content">{children}</div>
    </div>
  );
}
