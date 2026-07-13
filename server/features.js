// Organizer Pro feature gate — the single place every Pro-gated code path
// checks access. Nothing else should read Subscription.status or
// FeatureAccess directly (see handoff.md's "Feature Gate System" section
// for why: it's the one chokepoint that keeps client-side unlocking and
// permission escalation impossible — the flag is resolved server-side on
// every check, never trusted from a request body/header).
import { prisma } from "./db.js";

export const FEATURES = [
  // Discovery
  "featuredPlacement", "priorityRanking", "featuredOrganizerBadge", "homepageRecommendations",
  // Analytics
  "advancedAnalytics", "ticketClickTracking", "conversionTracking", "trafficSources", "audienceInsights", "eventComparisonReports",
  // Marketing
  "promoCodes", "discountCampaigns", "earlyBirdCampaigns", "scheduledAnnouncements", "bulkNotifications",
  // Team Management
  "teamMembers", "staffPermissions", "eventTemplates", "recurringEvents",
  // Operations
  "waitlists", "advancedAttendanceReports", "csvExports", "advancedCheckInAnalytics",
  // Branding
  "customOrganizerThemes", "customEventThemes", "customUrls", "customBranding", "reducedWeynBranding",
  // AI Studio (Gemini-powered — see server/ai.js)
  "aiStudio",
  // Event Workflows (node-graph automation builder, organizer-dashboard
  // parity with the venue side's Workflow/WorkflowRun) — see
  // server/event-workflows.js.
  "eventWorkflows",
  // Marketing Hub — see server/marketing.js (ad copy variants) and the new
  // /api/events/:id/marketing-links, /api/events/:id/referral-codes,
  // /api/organizer/marketing-calendar routes in server/app.js.
  "adCopyGeneration", "utmLinkBuilder", "referralPrograms", "marketingCalendar", "brandKit",
  // Venue Marketing Hub — the venue-dashboard counterpart to the flags
  // above, distinctly named (venue* prefix) so a venue owner's plan and an
  // organizer's plan gate independently even though FEATURES is one flat
  // catalog shared by both dashboards. See server/venue-marketing.js and
  // the /api/venues/:id/marketing-links, /api/venues/:id/loyalty,
  // /api/venues/:id/campaigns/:campaignId/winback-stats,
  // /api/venues/:id/brand-kit, and /api/venues/:id/marketing-calendar
  // routes in server/app.js.
  "venueWinBackCampaigns", "venueLoyaltyProgram", "venueUtmLinkBuilder", "venueMarketingCalendar", "venueBrandKit",
];
const FEATURE_SET = new Set(FEATURES);

// Launch state (see handoff.md): every organizer is auto-granted an ACTIVE
// "pro" subscription, free, the first time it's looked up — there's no
// signup/checkout flow that creates this eagerly, and no payment processor
// wired to actually charge anyone yet. This is the ONE function to change
// when real billing goes live: stop auto-granting "pro" here (default new
// rows to the "free" plan + INACTIVE instead) and let the Stripe webhook
// handler (see handoff.md's parked integration) be what upgrades someone
// to "pro". Nothing else in this file, or any caller of hasFeature(),
// needs to change.
export async function ensureSubscription(userId) {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;
  const proPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "pro" } });
  try {
    return await prisma.subscription.create({
      data: {
        userId,
        planId: proPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        // Far-future, not null — "free during launch" still reads as a real
        // active period rather than a special-cased "never expires" branch
        // everywhere else in the code has to know about.
        currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
      },
    });
  } catch (err) {
    // Two concurrent first-requests for the same brand-new user can both
    // reach here — treat the unique-constraint collision as "the other one
    // won", not a real error.
    if (err.code === "P2002") return prisma.subscription.findUniqueOrThrow({ where: { userId } });
    throw err;
  }
}

function isActive(sub) {
  return (sub.status === "ACTIVE" || sub.status === "TRIALING") &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now());
}

// The check every Pro-gated route/component ultimately calls. Returns
// false (never throws) for an unknown feature key — that's a caller typo,
// not a real permission decision, and should fail closed the same way.
export async function hasFeature(userId, feature) {
  if (!userId || !FEATURE_SET.has(feature)) return false;
  const sub = await ensureSubscription(userId);
  if (!isActive(sub)) return false;
  const access = await prisma.featureAccess.findUnique({ where: { planId_feature: { planId: sub.planId, feature } } });
  return !!access?.enabled;
}

// Batch form for the subscription dashboard / settings screen — one query
// for all ~28 flags instead of one hasFeature() call each.
export async function allFeatures(userId) {
  if (!userId) return Object.fromEntries(FEATURES.map((f) => [f, false]));
  const sub = await ensureSubscription(userId);
  if (!isActive(sub)) return Object.fromEntries(FEATURES.map((f) => [f, false]));
  const rows = await prisma.featureAccess.findMany({ where: { planId: sub.planId } });
  const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.feature));
  return Object.fromEntries(FEATURES.map((f) => [f, enabled.has(f)]));
}

// Express middleware for routes that are entirely Pro-gated (as opposed to
// a route that serves both tiers but changes behavior — those call
// hasFeature() directly instead). 403s with a machine-readable code so the
// frontend can show an upgrade prompt instead of a generic error.
export function requireFeature(feature) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
    const allowed = await hasFeature(req.user.id, feature);
    if (!allowed) return res.status(403).json({ error: { code: "FEATURE_LOCKED", message: "This is a Weyn Pro feature.", feature } });
    next();
  };
}
