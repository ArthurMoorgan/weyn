/** Dashboard navigation group labels and grouping metadata.
 * Used by Organizer, Venue, and Event dashboards to organize tab navigation
 * into semantic groups (Operations, Growth, Tools) with progressive
 * disclosure on mobile and visual grouping on desktop. The same three keys
 * are used on every surface so switching between the org-wide dashboard,
 * a per-event workspace, and a per-venue workspace doesn't require
 * relearning where things live. */

export const DASHBOARD_GROUPS = {
  operations: "Operations",
  growth: "Growth",
  tools: "Tools",
} as const;

export type DashboardGroupKey = keyof typeof DASHBOARD_GROUPS;
