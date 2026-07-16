// The actual Express app — every route lives here. Shared between two entry
// points: server/index.js (plain Node, local dev) and server/worker.js
// (Cloudflare Workers, production). Neither entry point's runtime-specific
// imports (dotenv, cloudflare:node, cloudflare:workers) belong in this file —
// `storage` (disk vs R2) is injected by whichever entry constructs the app,
// so this file never needs to know which runtime it's on.
import express from "express";
import QRCode from "qrcode";
import helmet from "helmet";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { db, prisma } from "./db.js";
import { sendOneSignalPush, oneSignalConfigured } from "./onesignal.js";
import { scrapeInstagramPost, parseEventFromCaption, downloadImage } from "./instagram-import.js";
import { generateMarketingCopy, scheduleDates, brandKitLine, generateAngledCopy, PERSUASION_ANGLE_KEYS, generateBulkAdVariants, generateGrowthIdeas, generateFreeToolIdeas } from "./marketing.js";
import { metaConfigured, buildMetaOAuthUrl, exchangeCodeForConnection, publishInstagramPost, IntegrationNotConfiguredError } from "./social-posting.js";
import { refineEventDraft, cleanEventTitle } from "./refine.js";
import { suggestImageFocalPoint, askClaude, askClaudeJson, aiConfigured, runAgentTurn, agentToolsConfigured } from "./ai.js";
import { AGENT_TOOLS, buildToolExecutor, toolByName } from "./agent-tools.js";
import { createCheckoutSession, fetchTransactionStatus, verifyIpnSignature, paytabsConfigured } from "./payments.js";
import { attachUser, requireAuth, requireRole, requireEventOwner, requireEventOwnerStrict, requireEventAccess, requireEventAccessOrPermission, authConfigured } from "./auth.js";
import { createEventSchema, updateEventSchema, eventWorkflowSchema, validateBody } from "./validators.js";
import { initSentry, initPostHog, captureError, trackEvent, Sentry, sentryReady } from "./monitoring.js";
import { FEATURES, hasFeature, allFeatures, ensureSubscription, requireFeature } from "./features.js";
import { sniffImageMime, EXT_BY_MIME } from "./image-utils.js";
import { sendEmail, emailConfigured, teamInviteEmail, bookingConfirmationEmail, organizerPaymentClaimEmail, organizerTeamInviteEmail, reminderEmail, waitlistWelcomeEmail, waitlistOwnerNotifyEmail } from "./email.js";
import { runModerationPipeline } from "./moderation.js";
import { resolveVenueSegment, LOYALTY_TIERS, loyaltyTierForVisits, venueGuestVisitCounts, winBackConversion, PERSUASION_ANGLE_KEYS as VENUE_PERSUASION_ANGLE_KEYS, generateVenueGrowthIdeas, generateVenueAngledCopy, generateVenueBulkAdVariants, generateVenueFreeToolIdeas } from "./venue-marketing.js";
import { runVenueWorkflows, validateWorkflowGraph } from "./venue-workflows.js";
import { runEventWorkflows, validateEventWorkflowGraph, redeemPromoCode } from "./event-workflows.js";

// Module-scope (not inside createApp): runCampaignScan/runAutomationScan
// below are top-level exports, called from a cron/interval outside any
// request — they need this at the same scope they're declared in. This was
// previously declared inside createApp() only, so those two functions threw
// ReferenceError on every single invocation (caught nowhere upstream) —
// Messaging Center's scheduled campaigns and the Automation Builder's
// capacity-threshold alerts have never actually sent since either shipped.
// Found during this session's security review, fixed alongside it.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Normalise a user-typed ticket URL so it always redirects OUT of the app.
function normalizeUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return "https:" + s;
  return "https://" + s.replace(/^\/+/, "");
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "event";

function publicOrigin(req) {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.VITE_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_URL must be set in production");
  }
  return `${req.protocol}://${req.get("host")}`;
}

// Notify a person by Weyn userId — OneSignal owns device/subscription
// management itself (both native and web SDKs register their own
// subscription and link it to this userId via OneSignal.login(), see
// src/push.ts), so this is now a thin wrapper rather than a per-device
// fan-out. Used wherever a server-side event (e.g. venue approval) needs to
// reach a *person* rather than the one deviceId a specific booking happened
// to be made from.
export async function notifyUser(userId, { title, body, data, url } = {}) {
  if (!userId) return { sent: 0 };
  const result = await sendOneSignalPush(userId, { title, body, data, url });
  return { sent: result.sent ? 1 : 0 };
}

// reminder scanner — every 5 min, notify devices whose booked event starts in
// ~2h. On Workers this is called from server/worker.js's scheduled() export
// (Cron Trigger); local Node dev calls it from a setInterval — same function.
const REMIND_LEAD_MS = 2 * 3600e3;
const SCAN_EVERY_MS = 5 * 60e3;
const PENDING_TTL_MS = 30 * 60e3; // abandoned checkouts older than this stop counting against capacity
export async function runReminderScan() {
  const now = Date.now();
  await db.expireStalePendingBookings(PENDING_TTL_MS);
  const due = await db.duePendingReminders(now + REMIND_LEAD_MS - SCAN_EVERY_MS, now + REMIND_LEAD_MS);
  for (const b of due) {
    // These are free-RSVP bookings keyed by deviceId only (no login
    // required), so there's no Weyn userId to target via OneSignal's
    // external_id here — push confirmation for anonymous bookings is
    // dropped (email reminders below still cover this case when an email
    // was collected). db.tokenForDevice/PushToken are unused now but left
    // in place — see server/onesignal.js and prisma/schema.prisma comments.
    await db.markReminded(b.deviceId, b.eventId);
  }

  // Organizer-configured T-N reminders (Event.reminderSchedule) — see
  // db.dueAutomatedReminders's comment on the due-window math.
  const autoDue = await db.dueAutomatedReminders(now, SCAN_EVERY_MS);
  for (const { event, offset, bookings } of autoDue) {
    const whenLabel = offset % 24 === 0 ? `${offset / 24} day${offset / 24 === 1 ? "" : "s"}` : `${offset} hour${offset === 1 ? "" : "s"}`;
    for (const b of bookings) {
      const ticketUrl = `${(process.env.PUBLIC_APP_URL || "https://weynevents.com").replace(/\/$/, "")}/e/${event.id}`;
      if (b.email && emailConfigured()) {
        sendEmail({ to: b.email, ...reminderEmail({ eventTitle: event.title, whenLabel, venue: `${event.venue}, ${event.area}`, ticketUrl }) })
          .catch((err) => captureError(err, { route: "runReminderScan (auto reminder email)", eventId: event.id, bookingId: b.id }));
      }
      // Same anonymous-booking limitation as above: b.deviceId has no
      // associated Weyn userId to target via OneSignal, so push is skipped
      // here — the email reminder above already covers this booking.
    }
    await db.markAutoRemindersSent(bookings.map((b) => b.id), offset);
  }
}

// Scheduled Messaging Center campaigns — same polling pattern as
// runReminderScan above (both fire from the same setInterval/Worker cron),
// picks up anything whose scheduledFor has passed and sends it exactly once.
export async function runCampaignScan() {
  const due = await db.dueCampaigns(Date.now());
  for (const c of due) {
    if (c.eventId && c.event) {
      const bookings = await prisma.booking.findMany({ where: { eventId: c.eventId, status: "paid", email: { not: null } }, select: { email: true } });
      const safeSubject = escapeHtml(c.subject || "");
      const safeMessage = escapeHtml(c.message);
      const safeTitle = escapeHtml(c.event.title);
      let emailed = 0;
      await Promise.all(bookings.map((b) =>
        sendEmail({
          to: b.email,
          subject: `${c.event.title}: ${c.subject || "An update"}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you have a ticket to ${safeTitle}.</p></div>`,
        }).then(() => emailed++).catch((err) => captureError(err, { route: "runCampaignScan", campaignId: c.id }))
      ));
      await db.markCampaignSent(c.id, emailed);
      continue;
    }
    if (c.venueId && c.venue) {
      const guests = await resolveVenueSegment(c.venueId, c.segment || { type: "all" });
      const safeSubject = escapeHtml(c.subject || "");
      const safeMessage = escapeHtml(c.message);
      const safeVenueName = escapeHtml(c.venue.name);
      let emailed = 0;
      await Promise.all(guests.map((g) =>
        sendEmail({
          to: g.email,
          subject: `${c.venue.name}: ${c.subject || "An update"}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you've booked with ${safeVenueName}.</p></div>`,
        }).then(() => emailed++).catch((err) => captureError(err, { route: "runCampaignScan", campaignId: c.id }))
      ));
      if (guests.length) {
        await prisma.venueCampaignRecipient.createMany({ data: guests.map((g) => ({ campaignId: c.id, guestEmail: g.email })) }).catch((err) => captureError(err, { route: "runCampaignScan:recipients", campaignId: c.id }));
      }
      await db.markCampaignSent(c.id, emailed);
      continue;
    }
    // Orphaned row (its event/venue was deleted after scheduling) — nothing
    // left to send to, mark it done rather than retrying forever.
    await db.markCampaignSent(c.id, 0);
  }
}

// Auto-assign a table to a just-created reservation, for venues that have
// a floor plan set up. Best-effort: a venue with no floor plan, or one
// that's fully booked for that date, just leaves the reservation
// unassigned for the staff to sort out manually (same as before this
// existed) — this never blocks or fails the reservation itself. Picks the
// smallest single table that fits the party (so a 2-top isn't wasted on a
// party of 2 when a booth for exactly that size is free); if nothing single
// fits, greedily merges the largest free tables until capacity is covered
// (mirrors the manual "merge" flow's own table-assignment shape).
export async function autoAssignTable(reservation) {
  try {
    const plan = await prisma.floorPlan.findUnique({ where: { venueId: reservation.venueId }, include: { tables: true } });
    if (!plan || plan.mode !== "table") return null; // seat-mode venues assign at the seat level, not here
    const size = reservation.partySize;
    const dayStart = new Date(reservation.date); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
    const assigned = await prisma.tableAssignmentTable.findMany({
      where: {
        tableId: { in: plan.tables.map((t) => t.id) },
        assignment: { date: { gte: dayStart, lt: dayEnd }, reservation: { status: { in: ["pending", "confirmed", "seated"] } } },
      },
      select: { tableId: true },
    });
    const takenIds = new Set(assigned.map((a) => a.tableId));
    const free = plan.tables.filter((t) => t.status === "available" && !takenIds.has(t.id));

    const singleFit = free.filter((t) => t.maxCapacity >= size && t.minCapacity <= size).sort((a, b) => a.maxCapacity - b.maxCapacity)[0];
    let chosen = singleFit ? [singleFit] : null;
    if (!chosen) {
      const combo = [];
      let total = 0;
      for (const t of [...free].sort((a, b) => b.maxCapacity - a.maxCapacity)) {
        combo.push(t); total += t.maxCapacity;
        if (total >= size) break;
      }
      if (total >= size && combo.length) chosen = combo;
    }
    if (!chosen) return null;

    await prisma.tableAssignment.create({
      data: { reservationId: reservation.id, date: reservation.date, time: reservation.time, partySize: size, tables: { create: chosen.map((t) => ({ tableId: t.id })) } },
    });
    return chosen.map((t) => t.label);
  } catch (err) {
    captureError(err, { route: "autoAssignTable", reservationId: reservation.id });
    return null;
  }
}

// A reservation just got cancelled — if this venue has anyone WAITING for
// that same date (closest-match on the requested day, not exact time,
// since "a table opened up" is worth telling someone even if it's not the
// exact hour they asked for), email the highest-priority/oldest one and
// flip them to NOTIFIED. Best-effort, mirrors runVenueWorkflows's own
// never-block-the-triggering-action contract — a broken email send here
// must never surface as a failure on the cancel action itself.
export async function notifyNextWaitlistEntry(cancelledReservation) {
  const dayStart = new Date(cancelledReservation.date); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
  const next = await prisma.venueWaitlistEntry.findFirst({
    where: { venueId: cancelledReservation.venueId, status: "WAITING", requestedDate: { gte: dayStart, lt: dayEnd } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  if (!next) return null;
  const venue = await prisma.venue.findUnique({ where: { id: cancelledReservation.venueId } });
  if (!venue) return null;
  const updated = await prisma.venueWaitlistEntry.update({ where: { id: next.id }, data: { status: "NOTIFIED", notifiedAt: new Date() } });
  await sendEmail({
    to: next.guestEmail,
    subject: `${venue.name}: A table just opened up`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">Good news, ${next.guestName.split(" ")[0] || "there"}</h2><p style="line-height:1.5;color:#222">A table just opened up at ${venue.name} for your party of ${next.partySize} around ${next.requestedTimeWindow} on ${next.requestedDate.toISOString().slice(0, 10)}. Reply or call to confirm and we'll get you seated.</p></div>`,
  }).catch(() => {});
  return updated;
}

// Automation Builder — only the "capacity_threshold" trigger is real today
// (see db.dueCapacityThresholdRules's comment); notifies the organizer by
// email/push once, then marks the rule run so it doesn't refire every scan.
// The actual immediate bulk-send behind POST /api/events/:id/notify —
// extracted to module scope so server/event-workflows.js's "send_campaign"
// action can reuse the exact same fan-out instead of reimplementing it.
export async function sendEventNotificationNow(event, { subject, message, actorId }) {
  const bookings = await prisma.booking.findMany({ where: { eventId: event.id, status: "paid" }, select: { email: true, deviceId: true } });
  let emailed = 0;
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message);
  const safeTitle = escapeHtml(event.title);
  await Promise.all(bookings.filter((b) => b.email).map((b) =>
    sendEmail({
      to: b.email,
      subject: `${event.title}: ${subject}`,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you have a ticket to ${safeTitle}.</p></div>`,
    }).then(() => emailed++).catch((err) => captureError(err, { route: "sendEventNotificationNow", eventId: event.id }))
  ));
  // Bookings here are keyed by deviceId, not Weyn userId (anonymous free
  // RSVP is supported), so there's no OneSignal external_id to target for
  // most of them — push fan-out for this bulk-notify action is dropped;
  // email above remains the reliable channel. If/when bookings start
  // capturing userId for signed-in attendees, this could resume via
  // notifyUser() for just those rows.
  const pushed = 0;
  await db.audit("event.notify", { actorId: actorId || null, entityType: "event", entityId: event.id, metadata: { subject, emailed, pushed } });
  await db.createCampaign({ organizerId: actorId || event.ownerId, eventId: event.id, subject, message, scheduledFor: null });
  return { recipients: bookings.length, emailed, pushed };
}

export async function runAutomationScan() {
  const due = await db.dueCapacityThresholdRules();
  for (const rule of due) {
    const e = rule.event;
    const pct = Math.round((e.sold / e.capacity) * 100);
    if (emailConfigured()) {
      const owner = await prisma.user.findUnique({ where: { id: e.ownerId }, select: { email: true } });
      if (owner?.email) {
        sendEmail({
          to: owner.email,
          subject: `${e.title} just hit ${pct}% sold`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p>Your automation rule "${escapeHtml(rule.name)}" fired: <b>${escapeHtml(e.title)}</b> is now ${pct}% sold.</p></div>`,
        }).catch((err) => captureError(err, { route: "runAutomationScan", ruleId: rule.id }));
      }
    }
    notifyUser(e.ownerId, { title: "Automation triggered", body: `${e.title} is ${pct}% sold.` }).catch(() => {});
    await db.markAutomationRuleRun(rule.id);
  }
}

// Birthday/anniversary reminder automation — evaluates AutomationRule rows
// with trigger === "contact_birthday" against MarketingContact.birthday,
// matching on month/day only (year is irrelevant/may be a placeholder).
// Deliberately a plain function, not wired into its own scheduler — call it
// once a day (e.g. folded into the existing 5-minute cron in
// server/worker.js with a same-day dedupe on rule.lastRunAt, same pattern
// as runAutomationScan's dueCapacityThresholdRules) rather than inventing a
// new cron surface for a single trigger type.
export async function runContactBirthdayScan() {
  const rules = await prisma.automationRule.findMany({ where: { trigger: "contact_birthday", enabled: true } });
  if (!rules.length) return;
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  for (const rule of rules) {
    // Same-day dedupe — a rule already run today doesn't refire on the next
    // tick, since this has no per-contact "already sent" state of its own.
    if (rule.lastRunAt && rule.lastRunAt.getUTCFullYear() === now.getUTCFullYear() && rule.lastRunAt.getUTCMonth() === now.getUTCMonth() && rule.lastRunAt.getUTCDate() === now.getUTCDate()) continue;
    let contacts;
    try {
      contacts = await prisma.marketingContact.findMany({ where: { organizerId: rule.organizerId, subscribed: true, birthday: { not: null } } });
    } catch (err) {
      // MarketingContact may not exist yet on this DB (pending migration,
      // see prisma/migrations' comments) — fail soft rather than crash the
      // whole scan for every other rule type.
      captureError(err, { route: "runContactBirthdayScan", ruleId: rule.id });
      continue;
    }
    const todays = contacts.filter((c) => c.birthday && c.birthday.getUTCMonth() + 1 === month && c.birthday.getUTCDate() === day);
    const config = rule.config || {};
    const subject = config.subject || "Happy birthday! 🎂";
    const message = config.message || "Wishing you a wonderful day — hope to see you at an event soon!";
    if (emailConfigured()) {
      await Promise.all(todays.map((c) => sendEmail({
        to: c.email,
        subject,
        html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p style="white-space:pre-wrap;line-height:1.5;color:#222">${escapeHtml(message)}</p></div>`,
      }).catch((err) => captureError(err, { route: "runContactBirthdayScan (email)", ruleId: rule.id }))));
    }
    await db.markAutomationRuleRun(rule.id);
  }
}
export { SCAN_EVERY_MS };

export function createApp(storage) {
  initSentry();
  initPostHog();
  // import.meta.url isn't reliably populated in Cloudflare's Workers bundle
  // — harmless, since __dirname is only used below for local-dev static
  // file serving, which is a no-op on Workers anyway (assets are served at
  // the platform level via wrangler.jsonc's `assets` binding instead).
  let __dirname = null;
  try { __dirname = path.dirname(fileURLToPath(import.meta.url)); } catch { /* Workers bundle — fine, see above */ }
  const app = express();
  app.set("trust proxy", 1);

  // Non-production deployments (dev.weynevents.com) are otherwise reachable
  // by anyone who guesses the subdomain — real user-facing data doesn't live
  // there, but it's still a live Clerk/DB instance we don't want indexed or
  // poked at. Gate the entire app behind HTTP Basic Auth whenever both env
  // vars are set; a no-op everywhere else (prod never sets these).
  const devAuthUser = process.env.DEV_BASIC_AUTH_USER;
  const devAuthPass = process.env.DEV_BASIC_AUTH_PASS;
  if (devAuthUser && devAuthPass) {
    app.use((req, res, next) => {
      const header = req.headers.authorization || "";
      const [scheme, encoded] = header.split(" ");
      if (scheme === "Basic" && encoded) {
        const [user, pass] = Buffer.from(encoded, "base64").toString("utf8").split(":");
        const userBuf = Buffer.from(user || "");
        const passBuf = Buffer.from(pass || "");
        const expectedUserBuf = Buffer.from(devAuthUser);
        const expectedPassBuf = Buffer.from(devAuthPass);
        const userOk = userBuf.length === expectedUserBuf.length && crypto.timingSafeEqual(userBuf, expectedUserBuf);
        const passOk = passBuf.length === expectedPassBuf.length && crypto.timingSafeEqual(passBuf, expectedPassBuf);
        if (userOk && passOk) return next();
      }
      res.set("WWW-Authenticate", 'Basic realm="Weyn dev"').status(401).send("Authentication required");
    });
  }

  // security headers (HSTS, X-Content-Type-Options, disabled X-Powered-By,
  // frame-ancestors via CSP, etc). Every directive below maps to a specific
  // external resource this app actually loads (see index.html, src/main.tsx's
  // ClerkProvider, and src/google-maps.ts) — no wildcards beyond Clerk's own
  // documented hosts, so a new third-party script/host added later will need
  // an explicit addition here rather than silently working.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // event covers are proxied through our own /uploads/:key route
        // (storage.readImage), never linked to R2/Blob directly — 'self'
        // covers them. data: for the inline SVG favicon, img.clerk.com for
        // Clerk-hosted avatars (Google-account pictures now come through
        // Clerk's own CDN, not directly from googleusercontent).
        imgSrc: ["'self'", "data:", "https://img.clerk.com"],
        // Clerk's React SDK does NOT bundle the real Clerk JS — it lazy-loads
        // it at runtime from Clerk's own Frontend API host via a dynamically
        // injected <script> tag (confirmed live: "Clerk: Failed to load
        // Clerk JS (code=failed_to_load_clerk_js)" on every page served
        // through this Express app, e.g. GET /e/:id, since those get this
        // CSP header — pages served as static files bypass this app entirely
        // and never hit the restriction, which is why the failure was easy
        // to miss testing only "/"). Same two hosts already allow-listed
        // below for connectSrc; script loading needs them too.
        scriptSrc: ["'self'", "https://maps.googleapis.com", "https://*.clerk.accounts.dev", "https://clerk.weynevents.com", "https://cdn.onesignal.com", "https://onesignal.com", "https://*.onesignal.com"],
        // Vite/React inject some inline <style> at runtime; Google Fonts'
        // stylesheet is itself hosted on fonts.googleapis.com
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        // Clerk's Frontend API — dev instances live on *.clerk.accounts.dev,
        // production instances get a dedicated clerk.<yourdomain> subdomain
        // once configured (see HANDOFF.md's Clerk section) — both covered.
        // PostHog (posthog-js, bundled via npm like Clerk — no scriptSrc host
        // needed, just its API host for event capture) uses whatever
        // VITE_POSTHOG_HOST is set to; both US and EU cloud covered since
        // either could be configured per-environment.
        connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://clerk.weynevents.com", "https://maps.googleapis.com", "https://nominatim.openstreetmap.org", "https://us.i.posthog.com", "https://eu.i.posthog.com", "https://onesignal.com", "https://*.onesignal.com", "https://cdn.onesignal.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  }));

  // blanket abuse ceiling — every route not covered by a tighter, route-
  // specific limiter below still gets this floor
  app.use(rateLimit({ windowMs: 15 * 60e3, max: 300, standardHeaders: true, legacyHeaders: false }));

  // CORS: comma-separated allowlist via env. Required in production — fail
  // loudly at boot rather than silently falling back to an open policy.
  const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV === "production" && !allowedOrigins.length) {
    throw new Error("CORS_ORIGIN must be set in production — refusing to start with an open CORS policy.");
  }
  app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

  if (process.env.NODE_ENV === "production" && !authConfigured()) {
    throw new Error("CLERK_SECRET_KEY must be set in production — refusing to start without real auth.");
  }
  if (process.env.NODE_ENV === "production" && !(process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.VITE_APP_URL)) {
    throw new Error("PUBLIC_APP_URL must be set in production — refusing to build payment or invite callback URLs from request input.");
  }

  // Hand-rolled JSON body parser instead of express.json() (body-parser).
  // body-parser pulls in raw-body -> iconv-lite for non-UTF-8 charset
  // support we never use (every request here is UTF-8 JSON) — and
  // iconv-lite's top-level code hits an unresolved gap in Cloudflare
  // Workers' Node stream polyfill at bundle time (a live upstream bug:
  // https://github.com/cloudflare/workers-sdk/issues/9309), which crashes
  // the deploy before a single request is even served. This also gives us
  // req.rawBody for free, which PayTabs' IPN signature needs anyway.
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    // multipart/form-data (event photo uploads) must reach multer with its
    // stream untouched — only intercept actual JSON bodies here
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) return next();
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { req.destroy(); return; } // 2mb cap, matches old express.json() limit
      chunks.push(chunk);
    });
    req.on("end", () => {
      req.rawBody = Buffer.concat(chunks);
      if (!req.rawBody.length) { req.body = {}; return next(); }
      try {
        req.body = JSON.parse(req.rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      next();
    });
    req.on("error", next);
  });
  app.use(attachUser); // sets req.user from a Bearer session token, if present and valid

  // Pre-launch private-beta gate. Clerk has a native allowlist feature that
  // would do this — but it 403s with "unsupported_subscription_plan_features"
  // on the plan the LIVE Clerk instance (clerk.weynevents.com) is actually
  // on, so it can only be enabled on free dev/test instances, not this one.
  // This replicates the same restriction ourselves until that's resolved
  // (upgrade the Clerk plan, or find another path) — set
  // ADMIN_ALLOWLIST_EMAILS (comma-separated) to activate; unset (the
  // default everywhere except the live prod deployment) is a complete
  // no-op.
  //
  // waitlist.weynevents.com's own landing page only ever calls one route
  // (POST /api/waitlist — see WaitlistLanding.tsx) — exempt exactly that,
  // not the hostname wholesale. A previous version of this exemption was
  // `if (req.hostname === "waitlist.weynevents.com") return next();`,
  // which waived this check for every route on that hostname, not just the
  // one the landing page needs — since Express routes by path only (Host
  // header is irrelevant to which handler runs), any /api/* route, on
  // EITHER domain, was reachable by anyone who simply requested
  // waitlist.weynevents.com instead of weynevents.com (no spoofing needed —
  // that hostname is already public DNS). That included both
  // unauthenticated public routes AND ones with no auth by deliberate
  // design (free ticket booking, paid checkout initiation) — the entire
  // "not launched yet" gate this middleware exists for was bypassable with
  // a single hostname swap. Confirmed live and fixed same-session; see
  // HANDOFF.md's security review notes for the full writeup.
  const adminAllowlist = (process.env.ADMIN_ALLOWLIST_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (adminAllowlist.length) {
    app.use((req, res, next) => {
      // Scoped to /api/* only — this is an API-access gate, not a page gate.
      // It used to run for every request regardless of path, which broke
      // every full-page navigation to a route this Node function actually
      // serves (chiefly GET /e/:id, rewritten here specifically for
      // OG-tag injection — see that route below): a plain top-level page
      // load/refresh/shared-link open never carries the Bearer token
      // attachUser looks for (only the SPA's own fetch() calls attach one
      // via authHeaders()), so req.user was always empty here and this
      // returned a raw JSON 403 instead of the app shell — for every
      // visitor, allowlisted admins included. The client-side AuthGate
      // (src/components/AuthGate.tsx) already re-checks admin status
      // correctly once Clerk's session is live in the browser; this
      // middleware only needs to keep /api/* honest.
      if (!req.path.startsWith("/api/")) return next();
      if (req.hostname === "waitlist.weynevents.com" && req.method === "POST" && req.path === "/api/waitlist") return next();
      const email = req.user?.email?.toLowerCase();
      if (email && adminAllowlist.includes(email)) return next();
      res.status(403).json({ error: { code: "PRIVATE_BETA", message: "Weyn is in private preview right now — join the waitlist at waitlist.weynevents.com." } });
    });
  }

  // event photos — served from wherever `storage` actually keeps them (local
  // disk or R2), so the URL shape (/uploads/:key) stays identical either way
  app.get("/uploads/:key", async (req, res) => {
    const img = await storage.readImage(req.params.key);
    if (!img) return res.status(404).end();
    res.set("Content-Type", img.mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(img.buffer);
  });

  // rate limiting — protects routes that cost real money per request (external
  // scraping + LLM calls) or that are natural abuse/spam targets
  const authLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
  const importLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10, standardHeaders: true, legacyHeaders: false });
  const createEventLimiter = rateLimit({ windowMs: 60 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
  // scalper/bot defense on the actual purchase endpoints — capacity claims
  // are already atomic (db.claimTierCapacity), so this isn't for
  // correctness, it's to keep one client from hammering checkout/book
  // fast enough to soak up all remaining stock before a human can click
  const bookingLimiter = rateLimit({ windowMs: 10 * 60e3, max: 15, standardHeaders: true, legacyHeaders: false });
  const checkinLimiter = rateLimit({ windowMs: 60e3, max: 60, standardHeaders: true, legacyHeaders: false });
  // reports feed the moderation signal, so a single actor spamming them can
  // skew what gets auto-flagged — tighter than the 300/15min global floor.
  const reportLimiter = rateLimit({ windowMs: 60 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
  // low-harm social writes (follow, collections) — a modest cap just to stop
  // scripted mass-actions, well above any real human's pace.
  const socialLimiter = rateLimit({ windowMs: 15 * 60e3, max: 120, standardHeaders: true, legacyHeaders: false });
  // venue applications are public + fire a real email to the team on every
  // submit — without a tight cap one IP could flood the inbox / Resend
  // quota and stuff the table with junk. A real venue owner applies once.
  const applicationLimiter = rateLimit({ windowMs: 60 * 60e3, max: 5, standardHeaders: true, legacyHeaders: false });
  // same reasoning as applicationLimiter — a public form that fires a real
  // email on every submit needs its own tight cap, separate from reports.
  const supportLimiter = rateLimit({ windowMs: 60 * 60e3, max: 10, standardHeaders: true, legacyHeaders: false });
  const waitlistLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10, standardHeaders: true, legacyHeaders: false });
  // Promo codes are short, human-guessable strings — without this, the
  // validate endpoint is a viable oracle for brute-forcing active codes.
  const promoValidateLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
  // Sends a real email per call, with no dedupe — bound how many an
  // authenticated (even brand-new) account can fire off.
  const teamInviteLimiter = rateLimit({ windowMs: 60 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });

  // hard cap on tickets per single booking request — stops one call from
  // draining a whole event's inventory or issuing a huge number of ticket
  // rows. Larger group bookings go through multiple requests or the organizer.
  const MAX_TICKETS_PER_BOOKING = 10;

  // ---- image upload ---- memoryStorage works identically under plain Node
  // and Workers (nodejs_compat) — no disk involved, `storage.saveImage`
  // decides where the bytes actually end up.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype);
      cb(ok ? null : new Error("Only image files are allowed"), ok);
    },
  });

  async function suggestFocalPointFor(imageUrl) {
    if (!imageUrl) return null;
    try {
      const img = await storage.readImage(imageUrl);
      if (!img) return null;
      return await suggestImageFocalPoint(img.buffer, img.mime);
    } catch {
      return null; // never block publishing over a cosmetic AI nicety
    }
  }

  // ---- routes ----
  app.get("/", (_req, res) => res.json({ name: "weyn-api", ok: true }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/events", async (req, res) => {
    let events = [...(await db.all())].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const { cat, q, organizer } = req.query;
    // Discovery feed only ever shows APPROVED events — DISCOVERY_LIMITED,
    // MANUAL_REVIEW, PENDING_REVIEW, and DISCOVERY_BLOCKED events are still
    // real and still reachable by direct link (see GET /api/events/:id),
    // they just don't get algorithmic reach. See server/moderation.js.
    // Past events also drop out of discovery once they're over: an event's
    // effective end is endsAt, or startsAt + 3h when no end time is set (so an
    // in-progress event without an explicit end stays visible while it's
    // happening rather than vanishing the moment it starts). Still reachable by
    // direct link via GET /api/events/:id so ticket-holders keep their event.
    const nowTs = Date.now();
    const isOver = (e) => {
      const end = e.endsAt ? new Date(e.endsAt).getTime() : new Date(e.startsAt).getTime() + 3 * 3600e3;
      return Number.isFinite(end) && end < nowTs;
    };
    // Invite-only events (see PATCH /api/events/:id/invite-only) never
    // appear in any listing/browse/search context — only reachable via a
    // direct link the organizer shares, which hits GET /api/events/:id
    // instead of this route.
    events = events.filter((e) => !e.cancelled && !e.isDraft && !e.isTemplate && e.discoveryStatus === "APPROVED" && !e.inviteOnly && !isOver(e));
    if (cat && cat !== "all") events = events.filter((e) => e.cat === cat);
    if (organizer) events = events.filter((e) => e.organizer === organizer);
    if (q) {
      const t = String(q).toLowerCase();
      events = events.filter((e) =>
        (e.title + e.organizer + e.area + e.venue + (e.tags || []).join(" ")).toLowerCase().includes(t)
      );
      db.track("search", { userId: req.user?.id, metadata: { query: q, resultCount: events.length } }).catch(() => {});
    }
    // no-store: this list changes on every publish, and a newly-created
    // event appearing to "not show up" for up to 30s on another device
    // (the previous max-age=30) reads as a real bug to users. The query
    // itself is cheap (~130ms), so correctness wins over the CDN discount.
    res.set('Cache-Control', 'no-store');
    res.json(events);
  });

  // Real Postgres full-text + trigram search (see db.searchEvents) — kept as
  // its own route rather than folding into /api/events' substring `q` filter
  // above, since that one loads every event into memory and does a naive
  // includes() check, fine for the current row count but not what should
  // power a real search box.
  app.get("/api/search", async (req, res) => {
    const { q, cat } = req.query;
    if (!q || !String(q).trim()) return res.json([]);
    const results = await db.searchEvents(String(q), { cat: cat ? String(cat) : undefined });
    db.track("search", { userId: req.user?.id, metadata: { query: q, resultCount: results.length } }).catch(() => {});
    res.json(results);
  });

  app.get("/api/events/:id", async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: "Event not found" });
    // DISCOVERY_BLOCKED is hidden from everyone except the organizer, who
    // gets to see WHY (their own dashboard surfaces the moderation reason)
    // rather than a silent 404 that looks like a bug. See moderation.js.
    const isOwner = req.user?.id && e.ownerId === req.user.id;
    if (e.discoveryStatus === "DISCOVERY_BLOCKED" && !isOwner) {
      return res.status(404).json({ error: "Event not found" });
    }
    if ((e.isDraft || e.isTemplate) && !isOwner) {
      return res.status(404).json({ error: "Event not found" });
    }
    db.track("event_view", { userId: req.user?.id, entityId: e.id }).catch(() => {});
    res.set('Cache-Control', e.inviteOnly ? 'private, no-store' : 'no-store');
    // Invite-only events are reachable by direct link (title/date/venue all
    // still show — the recipient needs to see what they're being invited
    // to), but the actual secret code is never sent to anyone except the
    // owner. The frontend already has it from the URL (?invite=CODE) if
    // it's unlocking the buy bar, so it never needs it echoed back here.
    const { inviteCode, ...safe } = e;
    // A single derived boolean, not the owner's whole feature set — the
    // public event page only needs to know whether to hide its own "Powered
    // by Weyn" badge, not anything else about the organizer's plan.
    const hideWeynBranding = e.ownerId ? await hasFeature(e.ownerId, "reducedWeynBranding") : false;
    res.json({ ...(isOwner ? e : safe), hideWeynBranding });
  });

  app.post("/api/events", createEventLimiter, requireAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "gallery", maxCount: 8 }]), validateBody(createEventSchema), async (req, res) => {
    try {
      const b = req.body;

      const rawTags = b.tags ? String(b.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
      const refined = await refineEventDraft({
        title: b.title,
        blurb: b.blurb,
        tags: rawTags,
        startsAt: b.startsAt || null,
        venue: b.venue && b.venue.trim() ? b.venue.trim() : null,
        area: b.area && b.area.trim() ? b.area.trim() : null,
      });

      const id = slug(refined.title || b.title) + "-" + crypto.randomUUID().slice(0, 4);
      const tags = refined.tags;
      // Weyn Ticketing is disabled while card payments aren't live — reject it
      // here (not just greyed out in the UI) so the API can't be used to
      // create a Weyn-ticketed event. Default also moved off "weyn" to "cash".
      // Re-enable by restoring "weyn" to the allowlist once PayTabs is set up.
      const ALLOWED_TICKETING = ["external", "cash", "registration", "organizer_payment"];
      if (b.ticketingType === "weyn") {
        return res.status(400).json({ error: { code: "TICKETING_DISABLED", message: "Weyn Ticketing isn't available yet — use an external link, registration form, or cash at the door." } });
      }
      const ticketingType = ALLOWED_TICKETING.includes(b.ticketingType) ? b.ticketingType : "cash";
      const existingImage = typeof b.existingImage === "string" && b.existingImage.startsWith("/uploads/") ? b.existingImage : null;

      let tiers = null;
      if (ticketingType === "weyn" && b.tiers) {
        try {
          const parsed = typeof b.tiers === "string" ? JSON.parse(b.tiers) : b.tiers;
          if (Array.isArray(parsed)) {
            tiers = parsed
              .filter((t) => t && String(t.name).trim())
              .map((t) => ({
                id: crypto.randomUUID().slice(0, 8),
                name: String(t.name).trim().slice(0, 40),
                price: Math.max(0, Number(t.price) || 0),
                capacity: Math.max(1, Number(t.capacity) || 1),
                sold: 0,
              }));
            if (!tiers.length) tiers = null;
          }
        } catch { tiers = null; }
      }

      const coverFile = req.files?.image?.[0];
      const galleryFiles = req.files?.gallery || [];

      let image = existingImage;
      if (coverFile) {
        const realMime = sniffImageMime(coverFile.buffer);
        if (!realMime) return res.status(400).json({ error: "That file doesn't look like a valid PNG/JPEG/WEBP/GIF" });
        const ext = EXT_BY_MIME[realMime];
        ({ url: image } = await storage.saveImage(coverFile.buffer, ext));
      }

      // Carousel: extra photos beyond the single cover image, uploaded the
      // same way. Invalid files are skipped rather than failing the whole
      // event — the cover image is the one thing that must succeed.
      const gallery = [];
      for (const file of galleryFiles) {
        const realMime = sniffImageMime(file.buffer);
        if (!realMime) continue;
        const ext = EXT_BY_MIME[realMime];
        const { url } = await storage.saveImage(file.buffer, ext);
        gallery.push(url);
      }

      const ev = {
        id,
        title: refined.title,
        organizer: (b.organizer || req.user.name || "You").trim(),
        ownerId: req.user.id,
        cat: b.cat || "community",
        startsAt: refined.startsAt || new Date(Date.now() + 3 * 3600e3).toISOString(),
        endsAt: b.endsAt || null,
        venue: (refined.venue || b.venue).trim(),
        area: (refined.area || b.area || "Muscat").trim(),
        lat: b.lat ? Number(b.lat) : 23.6100,
        lng: b.lng ? Number(b.lng) : 58.5400,
        distanceKm: Number(b.distanceKm) || +(Math.random() * 8 + 1).toFixed(1),
        price: tiers ? Math.min(...tiers.map((t) => t.price)) : Math.max(0, Number(b.price) || 0),
        capacity: tiers ? tiers.reduce((s, t) => s + t.capacity, 0) : Math.max(1, Number(b.capacity) || 50),
        sold: 0,
        tiers,
        image,
        // best-guess focal point (Gemini/Groq vision, see server/ai.js) so the same photo crops sensibly
        // across the card/detail/dashboard's different aspect ratios — cosmetic
        // only, silently null (plain center crop) if AI isn't configured/fails
        imageFocalPoint: await suggestFocalPointFor(image),
        gallery,
        color: b.color || "#3A4668",
        glyph: b.glyph || "🎟",
        blurb: (refined.blurb || b.blurb || "Join us — details to follow.").trim(),
        tags,
        refundPolicy: b.refundPolicy || "Set by organizer",
        minAge: Number(b.minAge) || 0,
        ticketingType,
        externalTicketUrl: (ticketingType === "external" || ticketingType === "registration") ? normalizeUrl(b.externalTicketUrl) : null,
        organizerContact: ticketingType === "cash" ? (b.organizerContact || "").trim() || null : null,
        paymentLinkUrl: ticketingType === "organizer_payment" && b.paymentLinkUrl ? normalizeUrl(b.paymentLinkUrl) : null,
        transferDetails: ticketingType === "organizer_payment" ? (b.transferDetails || "").trim() || null : null,
        sourceUrl: b.sourceUrl || null,
        importedFromInstagram: b.importedFromInstagram === "true" || b.importedFromInstagram === true,
        venueProfileId: typeof b.venueProfileId === "string" && b.venueProfileId ? b.venueProfileId : null,
      };

      // Event Builder 2.0: a draft skips moderation entirely (it's never
      // publicly visible either way — see the isDraft/isTemplate exclusion
      // in GET /api/events above) and runs it again for real at publish
      // time (POST /api/events/:id/publish), when it's actually going live.
      const isDraft = b.isDraft === "true" || b.isDraft === true;
      if (isDraft) {
        const inserted = await db.insert({ ...ev, isDraft: true, discoveryStatus: "PENDING_REVIEW" });
        return res.status(201).json({ ...inserted, discoveryStatus: "PENDING_REVIEW" });
      }

      // Trust & safety: hard-fail rules reject before the event ever exists;
      // everything else (AI review) runs after creation so the organizer
      // always gets a shareable link immediately — visibility, not
      // existence, is what the pipeline gates. See server/moderation.js.
      const moderation = await runModerationPipeline(ev, { triggeredBy: "publish" });
      if (moderation.hardFail) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Couldn't publish: ${moderation.hardFail.join(", ")}` } });
      }

      const inserted = await db.insert({ ...ev, discoveryStatus: moderation.discoveryStatus });
      await db.recordModeration(inserted.id, moderation.moderationResult);
      trackEvent(req.user.id, "event_create", { eventId: inserted.id, cat: inserted.cat, ticketingType: inserted.ticketingType });
      res.status(201).json({ ...inserted, discoveryStatus: moderation.discoveryStatus });
    } catch (err) {
      captureError(err, { route: "POST /api/events" });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Event Builder 2.0: drafts, autosave, templates ----
  // Lightweight autosave — a partial-field PATCH plus the raw wizard state
  // (draftData), only ever allowed on a row still marked isDraft. Doesn't
  // run refine.js/moderation — those are real "publish" concerns, and this
  // fires every few seconds while the organizer is still mid-form.
  app.patch("/api/events/:id/draft", requireEventOwner(), async (req, res) => {
    if (!req.event.isDraft) return res.status(409).json({ error: { code: "NOT_A_DRAFT", message: "This event is already published." } });
    const patch = { draftData: req.body?.draftData ?? undefined };
    for (const key of ["title", "venue", "area", "blurb", "cat", "price", "capacity"]) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    const updated = await db.update(req.event.id, patch);
    res.json(updated);
  });

  // Publishing runs the real moderation pipeline for the first time — a
  // draft never went through it, since it was never visible to anyone
  // anyway (see the isDraft exclusion in GET /api/events above).
  app.post("/api/events/:id/publish", requireEventOwner(), async (req, res) => {
    if (!req.event.isDraft) return res.json(req.event);
    const moderation = await runModerationPipeline(req.event, { triggeredBy: "publish" });
    if (moderation.hardFail) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Couldn't publish: ${moderation.hardFail.join(", ")}` } });
    }
    const updated = await db.update(req.event.id, { isDraft: false, discoveryStatus: moderation.discoveryStatus, draftData: null });
    await db.recordModeration(updated.id, moderation.moderationResult);
    runEventWorkflows("event_published", { eventId: updated.id }).catch(() => {});
    trackEvent(req.user.id, "event_publish", { eventId: updated.id });
    res.json(updated);
  });

  // Templates are just Event rows flagged isTemplate — "create from
  // template" reuses the exact same POST /api/events/:id/duplicate any
  // other event already uses (see below), no separate clone logic needed.
  app.post("/api/events/:id/save-template", requireEventOwner(), async (req, res) => {
    const updated = await db.update(req.event.id, { isTemplate: true, isDraft: false });
    res.json(updated);
  });
  app.get("/api/organizer/templates", requireAuth, async (req, res) => {
    const templates = await prisma.event.findMany({
      where: { ownerId: req.user.id, isTemplate: true, deletedAt: null },
      include: { tiers: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(templates.map((t) => { const { createdAt, deletedAt, ...rest } = t; return rest; }));
  });

  // ---- Venue Management: an organizer's own reusable venue library ----
  app.get("/api/organizer/venues", requireAuth, async (req, res) => {
    res.json(await prisma.eventVenue.findMany({ where: { organizerId: req.user.id }, orderBy: { createdAt: "desc" } }));
  });
  app.post("/api/organizer/venues", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Give this venue a name." } });
    const venue = await prisma.eventVenue.create({
      data: {
        organizerId: req.user.id, name: String(b.name).trim(), address: b.address || null,
        lat: b.lat != null ? Number(b.lat) : null, lng: b.lng != null ? Number(b.lng) : null,
        capacity: b.capacity != null ? Number(b.capacity) : null, parkingAvailable: !!b.parkingAvailable,
        accessibilityNotes: b.accessibilityNotes || null, indoorOutdoor: b.indoorOutdoor || null,
        images: Array.isArray(b.images) ? b.images : [], notes: b.notes || null,
        contacts: b.contacts || null, supplierContacts: b.supplierContacts || null,
      },
    });
    res.status(201).json(venue);
  });
  app.patch("/api/organizer/venues/:id", requireAuth, async (req, res) => {
    const existing = await prisma.eventVenue.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });
    const b = req.body || {};
    const patch = {};
    for (const key of ["name", "address", "accessibilityNotes", "indoorOutdoor", "notes"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    if (b.lat !== undefined) patch.lat = b.lat != null ? Number(b.lat) : null;
    if (b.lng !== undefined) patch.lng = b.lng != null ? Number(b.lng) : null;
    if (b.capacity !== undefined) patch.capacity = b.capacity != null ? Number(b.capacity) : null;
    if (b.parkingAvailable !== undefined) patch.parkingAvailable = !!b.parkingAvailable;
    if (b.images !== undefined) patch.images = Array.isArray(b.images) ? b.images : [];
    if (b.contacts !== undefined) patch.contacts = b.contacts;
    if (b.supplierContacts !== undefined) patch.supplierContacts = b.supplierContacts;
    const updated = await prisma.eventVenue.update({ where: { id: req.params.id }, data: patch });
    res.json(updated);
  });
  app.delete("/api/organizer/venues/:id", requireAuth, async (req, res) => {
    const existing = await prisma.eventVenue.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });
    // A live event referencing this venue keeps its own venue/area/lat/lng
    // strings regardless (they're copied at creation, not a live FK read) —
    // only the shortcut-picker link is cleared, via the FK's ON DELETE SET NULL.
    await prisma.eventVenue.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  });
  // Simple heuristic "AI recommendation" — real comparable-event data (same
  // pattern as the AI Studio pricing suggestion), not a fabricated claim.
  app.get("/api/organizer/venues/:id/recommendation", requireAuth, async (req, res) => {
    const venue = await prisma.eventVenue.findUnique({ where: { id: req.params.id } });
    if (!venue || venue.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });
    const pastEvents = await prisma.event.findMany({
      where: { venueProfileId: venue.id, cancelled: false, deletedAt: null, sold: { gt: 0 } },
      select: { cat: true, sold: true, capacity: true },
    });
    if (pastEvents.length < 2) return res.json({ recommendation: "Not enough past events at this venue yet for a real recommendation." });
    const byCat = {};
    for (const e of pastEvents) {
      const rate = e.capacity > 0 ? e.sold / e.capacity : 0;
      (byCat[e.cat] ||= []).push(rate);
    }
    const best = Object.entries(byCat).map(([cat, rates]) => ({ cat, avg: rates.reduce((s, r) => s + r, 0) / rates.length })).sort((a, b) => b.avg - a.avg)[0];
    res.json({ recommendation: `This venue performed best for ${best.cat} events (${Math.round(best.avg * 100)}% average sell-through across ${byCat[best.cat].length} event${byCat[best.cat].length === 1 ? "" : "s"}).` });
  });

  // Constant-time invite-code check — same reasoning as the DEV_BASIC_AUTH
  // gate above: a plain !== short-circuits on the first differing
  // character, which leaks timing information about how much of a guessed
  // code is correct. Low practical risk for an 8-char code, but it's a real
  // secret comparison so it gets the same treatment.
  function inviteCodeMatches(provided, actual) {
    if (typeof provided !== "string" || typeof actual !== "string") return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(actual);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function priceFor(e, tierId) {
    if (Array.isArray(e.tiers) && e.tiers.length) {
      const tier = e.tiers.find((t) => t.id === tierId);
      return tier ? tier.price : null;
    }
    return e.price;
  }

  // Promotion Center: the client captures ?utm_source/medium/campaign from
  // the event page URL and echoes them back on whichever booking route the
  // attendee ends up on (free RSVP, paid checkout, or organizer_payment) —
  // trusted as attribution only, never as anything security-sensitive.
  function utmFromBody(b) {
    const clean = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined);
    const source = clean(b?.utmSource), medium = clean(b?.utmMedium), campaign = clean(b?.utmCampaign);
    return source || medium || campaign ? { source, medium, campaign } : undefined;
  }

  app.post("/api/events/:id/book", bookingLimiter, async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: "Event not found" });
    if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
    if (e.inviteOnly && !inviteCodeMatches(req.body?.inviteCode, e.inviteCode)) {
      return res.status(403).json({ error: { code: "INVITE_REQUIRED", message: "This event is invite-only — a valid invite code is required." } });
    }
    if (e.ticketingType && e.ticketingType !== "weyn") {
      return res.status(400).json({ error: "This event isn't ticketed through Weyn — see externalTicketUrl/organizerContact instead" });
    }
    const qty = Math.min(MAX_TICKETS_PER_BOOKING, Math.max(1, Number(req.body?.qty) || 1));
    const price = priceFor(e, req.body?.tierId);
    if (price === null) return res.status(400).json({ error: "Please choose a ticket type" });
    // A paid ticket must NEVER be issued through this free path. This
    // previously only rejected when paytabsConfigured() was true — meaning
    // with payments unconfigured (the current state), a price>0 event fell
    // through and got booked for free with real tickets issued. Now any
    // paid ticket is refused here unconditionally: routed to checkout if we
    // can take payment, otherwise blocked outright until payments are live.
    if (price > 0) {
      return paytabsConfigured()
        ? res.status(400).json({ error: "This is a paid ticket — use POST /api/events/:id/checkout instead" })
        : res.status(503).json({ error: "Paid tickets aren't available yet — payments are still being set up." });
    }

    // Inventory-denial defense: a free RSVP claims real capacity, so without
    // this one client could book a free event to its cap with junk and lock
    // real people out. Require a device handle and allow one active booking
    // per device per event — the real UI always sends getDeviceId(), so this
    // only blocks scripted/repeat abuse, not a genuine attendee.
    const bookingDeviceId = req.body?.deviceId;
    if (!bookingDeviceId) {
      return res.status(400).json({ error: "A device id is required to reserve a free ticket." });
    }
    const dupe = await prisma.booking.findFirst({
      where: { eventId: e.id, deviceId: bookingDeviceId, status: { in: ["pending", "paid"] } },
      select: { id: true },
    });
    if (dupe) {
      return res.status(409).json({ error: "You've already reserved a ticket for this event." });
    }

    // Seat-mode events (assigned seating, see FloorPlan) require the guest
    // to have picked exactly `qty` specific seats before capacity is
    // touched — seats are the scarcer, more specific resource, so a seat
    // conflict should never leave capacity claimed with nothing to show for
    // it. Table-mode events and non-seated events skip this entirely.
    const eventFloorPlan = await prisma.floorPlan.findUnique({ where: { eventId: e.id } });
    let seatIds = null;
    if (eventFloorPlan?.mode === "seat") {
      seatIds = Array.isArray(req.body?.seatIds) ? [...new Set(req.body.seatIds.filter(Boolean))] : [];
      if (seatIds.length !== qty) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Please select exactly ${qty} seat(s)` } });
      }
      const validSeats = await prisma.floorSeat.findMany({ where: { id: { in: seatIds }, table: { floorPlanId: eventFloorPlan.id } } });
      if (validSeats.length !== seatIds.length) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid seat selection" } });
      }
      // Per-seat atomic claim — each UPDATE's WHERE clause IS the
      // availability check, same pattern as claimTierCapacity/claimEventCapacity.
      const claims = await prisma.$transaction(
        seatIds.map((sid) => prisma.$queryRaw`UPDATE "FloorSeat" SET status = 'reserved' WHERE id = ${sid} AND status = 'available' RETURNING id`)
      );
      const claimedIds = claims.flat().map((r) => r.id);
      if (claimedIds.length !== seatIds.length) {
        if (claimedIds.length) await prisma.floorSeat.updateMany({ where: { id: { in: claimedIds } }, data: { status: "available" } });
        return res.status(409).json({ error: { code: "SEAT_CONFLICT", message: "One or more selected seats were just taken — please pick different seats." } });
      }
    }

    let bookedTier = null;
    let remainingAfterClaim = null;
    const tierId = req.body?.tierId || null;
    if (Array.isArray(e.tiers) && e.tiers.length) {
      const tier = e.tiers.find((t) => t.id === tierId);
      if (!tier) return res.status(400).json({ error: "Please choose a ticket type" });
      // atomic claim — see db.claimTierCapacity's comment for why this can't
      // be a plain read-then-write without risking overselling under load
      const claimed = await db.claimTierCapacity(tier.id, qty);
      if (!claimed) {
        if (seatIds) await prisma.floorSeat.updateMany({ where: { id: { in: seatIds } }, data: { status: "available" } });
        return res.status(409).json({ error: `${tier.name} is sold out` });
      }
      await prisma.event.update({ where: { id: e.id }, data: { sold: { increment: qty } } });
      bookedTier = tier.name;
      remainingAfterClaim = claimed.capacity - claimed.sold;
    } else {
      const claimed = await db.claimEventCapacity(e.id, qty);
      if (!claimed) {
        if (seatIds) await prisma.floorSeat.updateMany({ where: { id: { in: seatIds } }, data: { status: "available" } });
        return res.status(409).json({ error: "Not enough tickets left" });
      }
      remainingAfterClaim = claimed.capacity - claimed.sold;
    }

    const deviceId = req.body?.deviceId;
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;
    const booking = await db.createPendingBooking({ eventId: e.id, tierId, deviceId, account, qty, utm: utmFromBody(req.body), refCode: req.body?.refCode });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "paid" } });
    if (seatIds) {
      await prisma.ticket.createMany({ data: seatIds.map((seatId) => ({ bookingId: booking.id, eventId: e.id, seatId })) });
    } else {
      await db.issueTickets(booking.id, e.id, qty);
    }
    {
      const wfCtx = { eventId: e.id, bookingId: booking.id, tierId, tierName: bookedTier, email: account?.email || null, qty, quantityRemaining: remainingAfterClaim };
      runEventWorkflows("ticket_sold", wfCtx).catch(() => {});
      runEventWorkflows("low_inventory", wfCtx).catch(() => {});
      if (req.body?.promoCode) {
        redeemPromoCode(e.id, req.body.promoCode, qty)
          .then((promo) => { if (promo) runEventWorkflows("promo_code_used", { ...wfCtx, promoCode: promo.code }).catch(() => {}); })
          .catch(() => {});
      }
    }
    // Free RSVP is deviceId-keyed with no login required, so there's no
    // Weyn userId to target via OneSignal here — booking confirmation push
    // is skipped; the email confirmation below covers it when an email was
    // collected.
    // Email confirmation — best-effort, independent of push. A booking
    // previously only ever produced a push notification, so anyone who
    // booked without push permission granted (or on a browser with no push
    // support at all) got zero confirmation of any kind that it worked.
    // Free RSVP's email is optional (only collected if the user typed one),
    // so this simply does nothing when it's absent — same as before.
    if (account?.email) {
      const dateStr = new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const { subject, html } = bookingConfirmationEmail({
        eventTitle: e.title, dateLabel: dateStr, venue: `${e.venue}, ${e.area}`,
        ticketUrl: `${publicOrigin(req)}/e/${e.id}?booking=${booking.id}&accessToken=${encodeURIComponent(booking.accessToken)}`,
        free: true,
      });
      sendEmail({ to: account.email, subject, html }).catch((err) => captureError(err, { route: "POST /api/events/:id/book (email)", bookingId: booking.id }));
    }
    trackEvent(req.user?.id || deviceId, "booking_completed", { eventId: e.id, qty, tierId, free: true });
    res.json({ ...(await db.get(e.id)), bookingId: booking.id, accessToken: booking.accessToken });
  });

  app.post("/api/events/:id/checkout", bookingLimiter, async (req, res) => {
    if (!paytabsConfigured()) return res.status(503).json({ error: "Payments aren't configured on this server yet" });
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: "Event not found" });
    if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
    if (e.inviteOnly && !inviteCodeMatches(req.body?.inviteCode, e.inviteCode)) {
      return res.status(403).json({ error: { code: "INVITE_REQUIRED", message: "This event is invite-only — a valid invite code is required." } });
    }
    if (e.ticketingType !== "weyn") {
      return res.status(400).json({ error: "This event isn't ticketed through Weyn" });
    }
    const qty = Math.min(MAX_TICKETS_PER_BOOKING, Math.max(1, Number(req.body?.qty) || 1));
    const tierId = req.body?.tierId || null;
    const basePrice = priceFor(e, tierId);
    if (basePrice === null) return res.status(400).json({ error: "Please choose a ticket type" });
    if (basePrice <= 0) return res.status(400).json({ error: "This ticket is free — use POST /api/events/:id/book instead" });

    const tier = tierId ? e.tiers.find((t) => t.id === tierId) : null;
    const remaining = tier ? tier.capacity - tier.sold : e.capacity - e.sold;
    if (qty > remaining) return res.status(409).json({ error: tier ? `${tier.name} is sold out` : "Not enough tickets left" });

    const deviceId = req.body?.deviceId;
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;

    // Redeemed (atomically, validity-checked) up front so the discounted
    // amount is what actually gets charged — previously this only fired
    // fire-and-forget *after* the session was created at the original
    // price, so a promo code validated in the UI never actually reduced
    // what the buyer paid.
    let unitPrice = basePrice;
    let appliedPromo = null;
    if (req.body?.promoCode) {
      appliedPromo = await redeemPromoCode(e.id, req.body.promoCode, qty);
      if (appliedPromo) {
        unitPrice = appliedPromo.discountType === "percent"
          ? +(basePrice * (1 - Number(appliedPromo.discountValue) / 100)).toFixed(3)
          : Math.max(0, +(basePrice - Number(appliedPromo.discountValue)).toFixed(3));
      }
    }

    const booking = await db.createPendingBooking({ eventId: e.id, tierId, deviceId, account, qty, utm: utmFromBody(req.body), refCode: req.body?.refCode });

    const origin = publicOrigin(req);
    try {
      const { tranRef, checkoutUrl } = await createCheckoutSession({
        booking,
        event: e,
        tier,
        unitPrice,
        successUrl: `${origin}/checkout/success?booking=${booking.id}&accessToken=${booking.accessToken}`,
        callbackUrl: `${origin}/api/payments/webhook`,
        customerIp: req.ip,
      });
      await prisma.payment.create({
        data: { bookingId: booking.id, paytabsTranRef: tranRef, amount: unitPrice * qty },
      });
      if (appliedPromo) {
        runEventWorkflows("promo_code_used", { eventId: e.id, bookingId: booking.id, tierId, email: account?.email || null, qty, promoCode: appliedPromo.code }).catch(() => {});
      }
      trackEvent(req.user?.id || deviceId, "checkout_started", { eventId: e.id, qty, tierId, amount: unitPrice * qty });
      res.json({ checkoutUrl, bookingId: booking.id, accessToken: booking.accessToken });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/checkout", eventId: e.id });
      res.status(502).json({ error: err.message });
    }
  });

  // ---- "organizer_payment" ticketing — organizer's own payment link or
  // bank-transfer details, confirmed manually rather than by a real
  // payment-gateway webhook (see schema.prisma's paymentLinkUrl comment). ----
  app.post("/api/events/:id/organizer-checkout", bookingLimiter, async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: "Event not found" });
    if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
    if (e.inviteOnly && !inviteCodeMatches(req.body?.inviteCode, e.inviteCode)) {
      return res.status(403).json({ error: { code: "INVITE_REQUIRED", message: "This event is invite-only — a valid invite code is required." } });
    }
    if (e.ticketingType !== "organizer_payment") {
      return res.status(400).json({ error: "This event doesn't use organizer payment ticketing" });
    }
    const qty = Math.min(MAX_TICKETS_PER_BOOKING, Math.max(1, Number(req.body?.qty) || 1));
    const tierId = req.body?.tierId || null;
    const price = priceFor(e, tierId);
    if (price === null) return res.status(400).json({ error: "Please choose a ticket type" });
    if (price <= 0) return res.status(400).json({ error: "This ticket is free — use POST /api/events/:id/book instead" });

    const tier = tierId ? e.tiers.find((t) => t.id === tierId) : null;
    const remaining = tier ? tier.capacity - tier.sold : e.capacity - e.sold;
    if (qty > remaining) return res.status(409).json({ error: tier ? `${tier.name} is sold out` : "Not enough tickets left" });
    if (!req.body?.email) return res.status(400).json({ error: "An email is required so we can send the ticket once payment is confirmed." });

    const deviceId = req.body?.deviceId;
    const account = { email: req.body.email, name: req.body.name };
    const booking = await db.createPendingBooking({ eventId: e.id, tierId, deviceId, account, qty, utm: utmFromBody(req.body), refCode: req.body?.refCode });
    await prisma.payment.create({ data: { bookingId: booking.id, amount: price * qty, status: "pending" } });
    if (req.body?.promoCode) {
      redeemPromoCode(e.id, req.body.promoCode, qty)
        .then((promo) => { if (promo) runEventWorkflows("promo_code_used", { eventId: e.id, bookingId: booking.id, tierId, email: account.email, qty, promoCode: promo.code }).catch(() => {}); })
        .catch(() => {});
    }
    trackEvent(req.user?.id || deviceId, "organizer_checkout_started", { eventId: e.id, qty, tierId, amount: price * qty });

    const redirectUrl = e.paymentLinkUrl
      ? e.paymentLinkUrl
      : `${publicOrigin(req)}/checkout/organizer-payment?booking=${booking.id}&accessToken=${encodeURIComponent(booking.accessToken)}`;
    res.json({ bookingId: booking.id, accessToken: booking.accessToken, redirectUrl });
  });

  // Public — the buyer's own "pay via transfer" page needs this to render
  // amount/instructions. Gated on the unguessable accessToken, same trust
  // model as GET /api/bookings/:id/tickets.
  app.get("/api/bookings/:id/organizer-payment", async (req, res) => {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { payment: true, event: true } });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!booking.accessToken || req.query.accessToken !== booking.accessToken) {
      return res.status(403).json({ error: "Access token is required" });
    }
    res.json({
      eventTitle: booking.event.title,
      amount: booking.payment?.amount ?? 0,
      transferDetails: booking.event.transferDetails,
      status: booking.status,
      claimedPaidAt: booking.claimedPaidAt,
    });
  });

  // The attendee's own "I've sent it" claim — never marks the booking paid
  // by itself, just flags it for the organizer and emails them. Rate-limited
  // the same as other public write endpoints to stop it being used to spam
  // an organizer's inbox.
  app.post("/api/bookings/:id/claim-paid", socialLimiter, async (req, res) => {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { payment: true, event: true } });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!booking.accessToken || req.body?.accessToken !== booking.accessToken) {
      return res.status(403).json({ error: "Access token is required" });
    }
    if (booking.status === "paid") return res.json({ ok: true, alreadyPaid: true });
    if (!booking.claimedPaidAt) {
      await prisma.booking.update({ where: { id: booking.id }, data: { claimedPaidAt: new Date() } });
      if (booking.event.ownerId && emailConfigured()) {
        const owner = await prisma.user.findUnique({ where: { id: booking.event.ownerId }, select: { email: true } });
        if (owner?.email) {
          const manageUrl = `${publicOrigin(req)}/organizer/events/${booking.eventId}/attendees`;
          sendEmail({
            to: owner.email,
            ...organizerPaymentClaimEmail({
              eventTitle: booking.event.title, buyerName: booking.name, buyerEmail: booking.email,
              amount: booking.payment?.amount ?? 0, manageUrl,
            }),
          }).catch((err) => captureError(err, { route: "POST /api/bookings/:id/claim-paid (email)", bookingId: booking.id }));
        }
      }
    }
    res.json({ ok: true });
  });

  // Owner-only — bookings waiting on manual payment confirmation for this event.
  app.get("/api/events/:id/pending-payments", requireEventOwner(), async (req, res) => {
    const bookings = await prisma.booking.findMany({
      where: { eventId: req.event.id, status: "pending" },
      include: { payment: true, tier: true },
      orderBy: { bookedAt: "desc" },
    });
    res.json(bookings.map((b) => ({
      id: b.id, email: b.email, name: b.name, qty: b.qty, tierName: b.tier?.name || null,
      amount: b.payment?.amount ?? 0, bookedAt: b.bookedAt, claimedPaidAt: b.claimedPaidAt,
    })));
  });

  // Owner confirms a transfer/payment-link booking actually arrived — the
  // manual equivalent of confirmPaymentFromPayTabs below (same capacity-claim
  // + ticket-issuing + confirmation-email steps), since there's no real
  // gateway webhook to trust for this ticketing type.
  app.post("/api/events/:id/bookings/:bookingId/confirm-payment", requireEventOwner(), async (req, res) => {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.bookingId }, include: { payment: true } });
    if (!booking || booking.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
    if (booking.status === "paid") return res.json(await db.getBooking(booking.id));
    if (booking.status !== "pending") return res.status(409).json({ error: { code: "INVALID_STATE", message: `Booking is ${booking.status}, not pending` } });

    const claimed = booking.tierId
      ? await db.claimTierCapacity(booking.tierId, booking.qty)
      : await db.claimEventCapacity(booking.eventId, booking.qty);
    if (!claimed) return res.status(409).json({ error: { code: "SOLD_OUT", message: "No capacity left to confirm this booking" } });
    if (booking.tierId) await prisma.event.update({ where: { id: booking.eventId }, data: { sold: { increment: booking.qty } } });

    await prisma.booking.update({ where: { id: booking.id }, data: { status: "paid" } });
    if (booking.payment) await prisma.payment.update({ where: { id: booking.payment.id }, data: { status: "paid" } });
    await db.issueTickets(booking.id, booking.eventId, booking.qty);
    {
      const remaining = claimed.capacity - claimed.sold;
      const wfCtx = { eventId: booking.eventId, bookingId: booking.id, tierId: booking.tierId, email: booking.email, qty: booking.qty, quantityRemaining: remaining };
      runEventWorkflows("ticket_sold", wfCtx).catch(() => {});
      runEventWorkflows("low_inventory", wfCtx).catch(() => {});
    }
    await db.audit("booking.organizer_payment.confirm", { actorId: req.user.id, entityType: "booking", entityId: booking.id, metadata: { eventId: booking.eventId } });
    trackEvent(req.user.id, "organizer_checkout_completed", { eventId: booking.eventId, qty: booking.qty });

    if (booking.email) {
      const dateStr = new Date(req.event.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const { subject, html } = bookingConfirmationEmail({
        eventTitle: req.event.title, dateLabel: dateStr, venue: `${req.event.venue}, ${req.event.area}`,
        ticketUrl: `${publicOrigin(req)}/e/${req.event.id}?booking=${booking.id}&accessToken=${encodeURIComponent(booking.accessToken)}`,
        free: false,
      });
      sendEmail({ to: booking.email, subject, html }).catch((err) => captureError(err, { route: "POST .../confirm-payment (email)", bookingId: booking.id }));
    }
    res.json(await db.getBooking(booking.id));
  });

  // ---- AI Studio ("aiStudio" feature — Gemini/Claude/Groq, whichever key
  // is configured, see server/ai.js). Every route here is a thin prompt
  // wrapper over real event/platform data — never auto-published anywhere,
  // the organizer always sees the output here first and copies it in
  // themselves (see HANDOFF's "AI outputs stay editable" note). ----
  app.post("/api/events/:id/ai/description", requireEventOwner(), requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const notes = String(req.body?.notes || "").trim().slice(0, 1000);
    if (!notes) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Give it a few bullet points or notes to work from." } });
    const prompt = `Write a polished, inviting event description (2-3 short paragraphs, no headings, no markdown) for an event called "${req.event.title}" in Muscat, Oman. Use these organizer notes as the source of truth — don't invent details not implied by them:\n\n${notes}`;
    try {
      const output = await askClaude(prompt, { maxTokens: 400 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: req.event.id, feature: "description", prompt, output });
      res.json({ description: output.trim() });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/ai/description", eventId: req.event.id });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't generate a description right now — try again shortly." } });
    }
  });

  app.post("/api/events/:id/ai/pricing-suggestion", requireEventOwner(), requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const comparables = await db.similarEventPricing(req.event.cat, req.event.capacity);
    if (comparables.length < 3) {
      return res.json({ suggestedPrice: null, reasoning: "Not enough similar past events on Weyn yet to base a suggestion on.", sampleSize: comparables.length });
    }
    const soldOutRate = comparables.filter((e) => e.sold >= e.capacity).length / comparables.length;
    const avgPrice = comparables.reduce((s, e) => s + e.price, 0) / comparables.length;
    const prompt = `An organizer is pricing a ${req.event.cat} event in Muscat with capacity ${req.event.capacity}. Similar past events on this platform (n=${comparables.length}) averaged ${avgPrice.toFixed(2)} OMR, with a ${(soldOutRate * 100).toFixed(0)}% sell-out rate. Suggest a single ticket price in OMR and explain your reasoning in 2 short sentences. Respond as strict JSON: {"suggestedPrice": <number>, "reasoning": "..."}`;
    try {
      const parsed = await askClaudeJson(prompt, { maxTokens: 200 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: req.event.id, feature: "pricing", prompt, output: JSON.stringify(parsed) });
      res.json({ ...parsed, sampleSize: comparables.length });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/ai/pricing-suggestion", eventId: req.event.id });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't generate a suggestion right now — try again shortly." } });
    }
  });

  app.post("/api/events/:id/ai/summary", requireEventOwner(), requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    if (new Date(req.event.startsAt).getTime() > Date.now()) {
      return res.status(400).json({ error: { code: "NOT_OVER_YET", message: "This event hasn't happened yet — check back after it's done." } });
    }
    const analytics = await db.eventAnalytics(req.event.id, { advanced: false });
    const prompt = `Write a short (3-4 sentence) post-event summary for the organizer of "${req.event.title}". Real numbers: ${analytics.ticketsSold} tickets sold out of ${analytics.capacity >= 9000 ? "unlimited" : analytics.capacity} capacity, ${analytics.revenue.toFixed(2)} OMR revenue. Be honest and specific — note whether it sold well or not, don't just say generic positive things. End with one concrete suggestion for their next event.`;
    try {
      const output = await askClaude(prompt, { maxTokens: 250 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: req.event.id, feature: "summary", prompt, output });
      res.json({ summary: output.trim(), stats: { ticketsSold: analytics.ticketsSold, capacity: analytics.capacity, revenue: analytics.revenue } });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/ai/summary", eventId: req.event.id });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't generate a summary right now — try again shortly." } });
    }
  });

  // Shared copywriting principles — same rules the dedicated venue-campaign
  // AI-draft route uses (see POST /api/venues/:id/campaigns/ai-draft below),
  // wired into the general assistants too so "help me write a caption for
  // this" or "what should I post today" gets copy that follows them, not
  // just the dedicated Marketing "AI draft" button.
  const MARKETING_COPY_PRINCIPLES = `When asked to write or suggest marketing copy (captions, emails, posts, descriptions), follow these rules: benefit-first framing, not feature-first — lead with what's in it for the reader. One clear angle/hook, not three things at once. Never invent statistics, urgency, or social proof that isn't verifiably real. Warm, direct, human tone — no corporate voice, no excessive exclamation points. Keep it tight and platform-appropriate in length.`;

  // Org-wide AI Assistant — a general Q&A chat grounded in the organizer's
  // own dashboard numbers (not a generic chatbot), so "how's my next event
  // looking?" gets a real answer instead of a made-up one. History is kept
  // client-side and replayed each turn — no server-side chat session state.
  app.post("/api/organizer/ai/assistant", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const message = String(req.body?.message || "").trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Say something first." } });
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
    const [overview, finance] = await Promise.all([db.organizerOverview(req.user.id), db.organizerFinance(req.user.id)]);
    const context = `Organizer's current numbers on Weyn: ${overview.nextUpcoming?.length ?? 0} upcoming events shown on their dashboard, ${finance.totalRevenue} OMR total revenue across ${finance.byEvent.length} events with sales. Top events by revenue: ${finance.byEvent.slice(0, 3).map((e) => `${e.title} (${e.revenue} OMR, ${e.ticketsSold} tickets)`).join("; ") || "none yet"}.`;
    const transcript = history.map((h) => `${h.role === "assistant" ? "Assistant" : "Organizer"}: ${h.content}`).join("\n");
    const prompt = `You're a helpful assistant inside an event organizer's dashboard on Weyn (an Oman events platform). Answer concisely and specifically, grounded only in the real data given — never invent numbers.\n\n${MARKETING_COPY_PRINCIPLES}\n\n${context}\n\n${transcript ? transcript + "\n" : ""}Organizer: ${message}\nAssistant:`;
    try {
      const output = await askClaude(prompt, { maxTokens: 350 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: null, feature: "assistant", prompt, output });
      res.json({ reply: output.trim() });
    } catch (err) {
      captureError(err, { route: "POST /api/organizer/ai/assistant" });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't reply right now — try again shortly." } });
    }
  });

  // ---- Weyn AI assistant, agentic mode (Phase 1) ----
  // Same idea as the assistant above, but with real tools (see
  // server/agent-tools.js) instead of pre-fetched context glued into a
  // prompt string. Read-only tools execute immediately as part of the
  // turn; anything that mutates state is created as a pending AgentAction
  // instead of executed here — see the three routes below it for the
  // review/approve/reject flow. History is still client-replayed (same as
  // the plain assistant), but in Gemini's own {role, parts} turn shape
  // rather than a flattened transcript string, since tool-call/tool-result
  // turns need to round-trip in that shape for the model to stay coherent
  // across turns.
  const AGENT_SYSTEM_PROMPT = `You are Weyn AI, an operations assistant embedded in an event/venue organizer's dashboard on Weyn (an Oman events + reservations platform). You have tools to look up real data and to propose actions — you can never directly change anything yourself. Every tool that creates/sends/cancels something only ever gets PROPOSED for the owner to review and approve; it is never actually executed by you calling the tool. Always pass a clear, specific "reasoning" argument to any such tool explaining why you're proposing it. Ground every answer in real tool results — never invent numbers, customers, or reservations. Be concise.\n\n${MARKETING_COPY_PRINCIPLES}`;

  app.post("/api/organizer/ai/agent", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    if (!agentToolsConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const message = String(req.body?.message || "").trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Say something first." } });
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-20) : [];
    try {
      const result = await runAgentTurn({
        systemPrompt: AGENT_SYSTEM_PROMPT,
        history,
        userMessage: message,
        tools: AGENT_TOOLS,
        executeTool: buildToolExecutor(req.user.id),
      });
      const proposedActionIds = result.toolCalls.filter((c) => c.result?.proposed).map((c) => c.result.actionId);
      const proposedActions = proposedActionIds.length
        ? await prisma.agentAction.findMany({ where: { id: { in: proposedActionIds } } })
        : [];
      await db.logAiGeneration({ organizerId: req.user.id, eventId: null, feature: "agent", prompt: message, output: result.text });
      res.json({ reply: result.text, history: result.history, proposedActions });
    } catch (err) {
      captureError(err, { route: "POST /api/organizer/ai/agent" });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't reply right now — try again shortly." } });
    }
  });

  app.get("/api/organizer/ai/actions", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const actions = await prisma.agentAction.findMany({
      where: { organizerId: req.user.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(actions);
  });

  app.post("/api/organizer/ai/actions/:id/approve", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    const action = await prisma.agentAction.findUnique({ where: { id: req.params.id } });
    if (!action || action.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Action not found" } });
    if (action.status !== "proposed") return res.status(409).json({ error: { code: "ALREADY_DECIDED", message: `This action was already ${action.status}.` } });
    const tool = toolByName(action.tool);
    if (!tool) return res.status(500).json({ error: { code: "UNKNOWN_TOOL", message: "This tool no longer exists." } });
    try {
      const result = await tool.execute(action.args, { userId: req.user.id });
      const updated = await prisma.agentAction.update({
        where: { id: action.id },
        data: { status: "executed", result, decidedAt: new Date(), executedAt: new Date() },
      });
      res.json(updated);
    } catch (err) {
      const updated = await prisma.agentAction.update({
        where: { id: action.id },
        data: { status: "failed", error: err.message || String(err), decidedAt: new Date() },
      });
      res.status(422).json(updated);
    }
  });

  app.post("/api/organizer/ai/actions/:id/reject", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    const action = await prisma.agentAction.findUnique({ where: { id: req.params.id } });
    if (!action || action.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Action not found" } });
    if (action.status !== "proposed") return res.status(409).json({ error: { code: "ALREADY_DECIDED", message: `This action was already ${action.status}.` } });
    const updated = await prisma.agentAction.update({ where: { id: action.id }, data: { status: "rejected", decidedAt: new Date() } });
    res.json(updated);
  });

  // AI Insights report — a written narrative over the organizer's own
  // cross-event numbers (same data Overview/Finance already show as charts),
  // for someone who wants the "so what" in a paragraph instead of parsing
  // graphs themselves.
  app.post("/api/organizer/ai/insights", requireAuth, requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const [overview, finance] = await Promise.all([db.organizerOverview(req.user.id), db.organizerFinance(req.user.id)]);
    if (!finance.byEvent.length) {
      return res.json({ insights: "Not enough sales history yet to generate insights — come back once you've had a few bookings." });
    }
    const prompt = `Write a short (4-5 sentence) insights report for an event organizer on Weyn. Real data: total revenue ${finance.totalRevenue} OMR across ${finance.byEvent.length} events, ${finance.feesPaid} OMR in platform fees. Revenue by event: ${finance.byEvent.map((e) => `${e.title}: ${e.revenue} OMR (${e.ticketsSold} tickets)`).join("; ")}. Monthly revenue trend: ${finance.revenueByMonth.map((m) => `${m.month}: ${m.revenue} OMR`).join(", ") || "no trend data yet"}. Identify what's working, what's not, and end with one concrete, specific recommendation. Don't invent numbers not given here.`;
    try {
      const output = await askClaude(prompt, { maxTokens: 350 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: null, feature: "insights", prompt, output });
      res.json({ insights: output.trim() });
    } catch (err) {
      captureError(err, { route: "POST /api/organizer/ai/insights" });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't generate insights right now — try again shortly." } });
    }
  });

  app.post("/api/payments/webhook", async (req, res) => {
    const signature = req.header("Signature") || req.header("signature");
    if (!verifyIpnSignature(req.rawBody, signature)) {
      return res.status(401).json({ error: "Invalid IPN signature" });
    }
    const tranRef = req.body?.tran_ref;
    if (!tranRef) return res.status(400).json({ error: "No tran_ref in webhook payload" });
    const payment = await prisma.payment.findUnique({ where: { paytabsTranRef: tranRef }, include: { booking: true } });
    if (!payment) return res.status(404).json({ error: "Unknown transaction" });
    try {
      await confirmPaymentFromPayTabs(payment, req.body);
    } catch (err) {
      captureError(err, { route: "POST /api/payments/webhook", paymentId: payment.id });
    }
    res.json({ ok: true });
  });

  async function confirmPaymentFromPayTabs(payment, rawWebhook) {
    if (payment.status === "paid") return;
    const { success, raw } = await fetchTransactionStatus(payment.paytabsTranRef);
    await prisma.payment.update({ where: { id: payment.id }, data: { rawWebhook: rawWebhook || raw, status: success ? "paid" : "failed" } });
    if (!success) return;

    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking || booking.status === "paid") return;

    // Prisma's $transaction with a read-then-write doesn't lock the row at
    // Postgres's default isolation level — two webhooks racing for the same
    // last seat could both pass a plain "tier.sold + qty > capacity" check
    // before either commits. Use the same atomic conditional UPDATE as the
    // free-booking path instead (see db.claimTierCapacity's comment).
    const claimed = booking.tierId
      ? await db.claimTierCapacity(booking.tierId, booking.qty)
      : await db.claimEventCapacity(booking.eventId, booking.qty);
    if (!claimed) {
      // Payment succeeded but capacity is gone (shouldn't normally happen —
      // checkout already checks remaining stock — but a paid booking must
      // never silently vanish). Flag it for manual refund instead of
      // dropping it, and don't mark as paid or issue tickets.
      captureError(new Error(`payment ${payment.id} succeeded but capacity is gone for booking ${booking.id} — needs manual refund review`));
      await db.audit("payment.oversold", { entityType: "booking", entityId: booking.id, metadata: { paymentId: payment.id } });
      return;
    }
    if (booking.tierId) await prisma.event.update({ where: { id: booking.eventId }, data: { sold: { increment: booking.qty } } });

    await prisma.booking.update({ where: { id: booking.id }, data: { status: "paid" } });
    await db.issueTickets(booking.id, booking.eventId, booking.qty);
    {
      const remaining = claimed.capacity - claimed.sold;
      const wfCtx = { eventId: booking.eventId, bookingId: booking.id, tierId: booking.tierId, email: booking.email, qty: booking.qty, quantityRemaining: remaining };
      runEventWorkflows("ticket_sold", wfCtx).catch(() => {});
      runEventWorkflows("low_inventory", wfCtx).catch(() => {});
    }
    trackEvent(booking.deviceId || "unknown", "checkout_completed", { eventId: booking.eventId, qty: booking.qty });

    const e = await db.get(booking.eventId);
    // Same as the free-RSVP flow above: paid bookings are deviceId-keyed,
    // not userId-keyed, so there's no OneSignal external_id to target —
    // the email confirmation below (always collected for paid checkout)
    // covers this instead.
    // Paid checkout always collects an email (unlike free RSVP, where it's
    // optional) — see the checkout form — so this fires for every paid
    // booking, not just ones where push happened to be available.
    if (booking.email && e) {
      const dateStr = new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const { subject, html } = bookingConfirmationEmail({
        eventTitle: e.title, dateLabel: dateStr, venue: `${e.venue}, ${e.area}`,
        ticketUrl: `${(process.env.PUBLIC_APP_URL || "https://weynevents.com").replace(/\/$/, "")}/e/${e.id}?booking=${booking.id}&accessToken=${encodeURIComponent(booking.accessToken)}`,
        free: false,
      });
      sendEmail({ to: booking.email, subject, html }).catch((err) => captureError(err, { route: "confirmPaymentFromPayTabs (email)", bookingId: booking.id }));
    }
  }

  app.get("/api/bookings/:id", async (req, res) => {
    const booking = await db.getBooking(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status === "pending" && booking.payment?.paytabsTranRef) {
      try { await confirmPaymentFromPayTabs(booking.payment, null); } catch { /* keep pending, client will poll again */ }
    }
    const fresh = await db.getBooking(req.params.id);
    res.json({ id: fresh.id, status: fresh.status, eventId: fresh.eventId, eventTitle: fresh.event?.title || null });
  });

  // codes rendered as QR client-side — the booking owner needs these to show
  // at the door, so no auth beyond knowing the (unguessable cuid) booking id
  app.get("/api/bookings/:id/tickets", async (req, res) => {
    // try/catch so a DB error returns a real 500 instead of an unhandled
    // rejection that hangs the request (Express-4 async gap — see the
    // security audit's note on un-wrapped async handlers).
    try {
      const booking = await db.getBooking(req.params.id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.accessToken && req.query.accessToken !== booking.accessToken) {
        return res.status(403).json({ error: "Ticket access token is required" });
      }
      const tickets = await db.ticketsForBooking(req.params.id);
      res.json(tickets.map((t) => ({ code: t.code, checkedInAt: t.checkedInAt })));
    } catch (e) {
      console.error("[weyn] GET /api/bookings/:id/tickets failed:", e?.message);
      res.status(500).json({ error: "Couldn't load your ticket." });
    }
  });

  // Door check-in — only the event's owner/staff (or an ADMIN) can scan
  // tickets for it, and the underlying UPDATE is conditional on
  // checkedInAt still being null, so a code can never admit twice even if
  // two staff scan it at the same instant (see db.checkInTicket).
  app.post("/api/tickets/:code/checkin", checkinLimiter, requireAuth, async (req, res) => {
    const method = req.body?.method === "manual" ? "manual" : "qr";
    const ticket = await db.getTicketByCode(req.params.code);
    if (!ticket) {
      // No eventId to attach an INVALID CheckIn row to without knowing which
      // event's scanner this came from, so this is only ever logged if the
      // client tells us — best-effort, not required for the route to work.
      if (req.body?.eventId) {
        await prisma.checkIn.create({ data: { eventId: req.body.eventId, scannedBy: req.user.id, method, status: "INVALID" } }).catch(() => {});
      }
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown ticket code" } });
    }
    const isOwner = ticket.event.ownerId && ticket.event.ownerId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      // STAFF is the minimum team role that can check people in — this is
      // the one action a door-staff invite is actually for
      const membership = await db.getTeamMembership(ticket.eventId, req.user.id);
      if (!membership) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this event" } });
      }
    }
    if (ticket.checkedInAt) {
      await prisma.checkIn.create({ data: { eventId: ticket.eventId, ticketId: ticket.id, bookingId: ticket.bookingId, scannedBy: req.user.id, method, status: "DUPLICATE" } }).catch(() => {});
      return res.status(409).json({ error: { code: "ALREADY_USED", message: `Already checked in at ${ticket.checkedInAt.toISOString()}` } });
    }
    const result = await db.checkInTicket(req.params.code, req.user.id);
    if (!result) {
      await prisma.checkIn.create({ data: { eventId: ticket.eventId, ticketId: ticket.id, bookingId: ticket.bookingId, scannedBy: req.user.id, method, status: "DUPLICATE" } }).catch(() => {});
      return res.status(409).json({ error: { code: "ALREADY_USED", message: "This ticket was just checked in by someone else" } });
    }
    await prisma.checkIn.create({ data: { eventId: ticket.eventId, ticketId: ticket.id, bookingId: ticket.bookingId, scannedBy: req.user.id, method, status: "VALID" } }).catch(() => {});
    await db.audit("ticket.checkin", { actorId: req.user.id, entityType: "ticket", entityId: ticket.id, metadata: { eventId: ticket.eventId, bookingId: ticket.bookingId } });
    trackEvent(req.user.id, "ticket_checkin", { eventId: ticket.eventId });
    res.json({ ok: true, checkedInAt: result.checkedInAt });
  });

  // Live check-in progress + history for an event's scanner UI.
  app.get("/api/events/:id/checkins", requireEventAccess("STAFF"), async (req, res) => {
    const [total, checkedIn, recent] = await Promise.all([
      prisma.ticket.count({ where: { eventId: req.event.id } }),
      prisma.ticket.count({ where: { eventId: req.event.id, checkedInAt: { not: null } } }),
      prisma.checkIn.findMany({ where: { eventId: req.event.id }, orderBy: { scannedAt: "desc" }, take: 100 }),
    ]);
    res.json({ total, checkedIn, recent });
  });

  // ---- Ticket transfers: reassign a ticket to a different attendee's
  // email. The Ticket row (and its scannable `code`) never changes — this
  // just relabels who it belongs to, and re-sends the ticket QR email to
  // the new holder so they actually have something to show at the door. ----
  app.post("/api/tickets/:code/transfer", requireAuth, async (req, res) => {
    const toEmail = String(req.body?.toEmail || "").trim();
    if (!toEmail || !toEmail.includes("@")) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid toEmail is required." } });
    }
    const ticket = await db.getTicketByCode(req.params.code);
    if (!ticket) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown ticket code" } });
    const isOwner = ticket.event.ownerId && ticket.event.ownerId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      const membership = await db.getTeamMembership(ticket.eventId, req.user.id);
      // Require MANAGER+, not merely any membership: STAFF is door-only
      // (check-in), and reassigning a paid ticket to an arbitrary email is a
      // materially more privileged action than scanning at the door. This
      // route previously copied check-in's "any membership passes" check,
      // which let a STAFF invitee hijack tickets (security audit finding).
      if (!membership || TEAM_ROLE_RANK[membership.role] < TEAM_ROLE_RANK.MANAGER) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this event" } });
      }
    }
    if (ticket.checkedInAt) {
      return res.status(409).json({ error: { code: "ALREADY_USED", message: "Can't transfer a ticket that's already been checked in." } });
    }
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { transferredToEmail: toEmail, transferredAt: new Date(), transferredBy: req.user.id },
    });
    await db.audit("ticket.transfer", { actorId: req.user.id, entityType: "ticket", entityId: ticket.id, metadata: { eventId: ticket.eventId, bookingId: ticket.bookingId, toEmail } });
    const e = ticket.event;
    if (emailConfigured()) {
      const dateStr = new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const { subject, html } = bookingConfirmationEmail({
        eventTitle: e.title, dateLabel: dateStr, venue: `${e.venue}, ${e.area}`,
        ticketUrl: `${publicOrigin(req)}/e/${e.id}?booking=${ticket.bookingId}&accessToken=${encodeURIComponent(ticket.booking.accessToken || "")}`,
        free: e.price <= 0,
      });
      sendEmail({ to: toEmail, subject: `A ticket to ${e.title} was transferred to you`, html }).catch((err) => captureError(err, { route: "POST /api/tickets/:code/transfer (email)", ticketId: ticket.id }));
    }
    res.json({ ok: true, ticket: updated });
  });

  const EDITABLE_FIELDS = ["title", "blurb", "price", "capacity", "startsAt", "refundPolicy", "venue", "area", "minAge", "tags", "ticketingType", "externalTicketUrl", "organizerContact", "paymentLinkUrl", "transferDetails", "reminderSchedule", "accentColor"];
  app.patch("/api/events/:id", requireEventOwner(), validateBody(updateEventSchema), async (req, res) => {
    const e = req.event;
    const patch = {};
    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] === undefined) continue;
      if (key === "price") patch.price = Math.max(0, Number(req.body.price) || 0);
      else if (key === "capacity") patch.capacity = Math.max(e.sold, Number(req.body.capacity) || e.capacity);
      else if (key === "minAge") patch.minAge = Math.max(0, Number(req.body.minAge) || 0);
      else if (key === "tags") patch.tags = Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags).split(",").map((t) => t.trim()).filter(Boolean);
      // "weyn" excluded — can't switch an event to Weyn Ticketing while it's
      // disabled (mirrors the create-route block; keeps the API consistent
      // with the greyed-out UI). Existing weyn events keep their type on edit.
      else if (key === "ticketingType") patch.ticketingType = ["external", "cash", "registration", "organizer_payment"].includes(req.body.ticketingType) ? req.body.ticketingType : e.ticketingType;
      else if (key === "externalTicketUrl") patch.externalTicketUrl = normalizeUrl(req.body.externalTicketUrl);
      else if (key === "paymentLinkUrl") patch.paymentLinkUrl = req.body.paymentLinkUrl ? normalizeUrl(req.body.paymentLinkUrl) : null;
      else if (key === "title") patch.title = cleanEventTitle(req.body.title) || e.title;
      else if (key === "reminderSchedule") {
        const schedule = Array.isArray(req.body.reminderSchedule) ? req.body.reminderSchedule.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
        // Feature-gated here rather than a dedicated route (like promo
        // codes/featured) since it's one field on an otherwise-generic
        // update — silently keeps the event's existing schedule instead of
        // erroring, same treatment as the "weyn" ticketingType guard above.
        if (schedule.length > 0 && !(await hasFeature(req.user.id, "scheduledAnnouncements"))) continue;
        patch.reminderSchedule = schedule;
      }
      else if (key === "accentColor") {
        const color = /^#[0-9a-fA-F]{6}$/.test(req.body.accentColor || "") ? req.body.accentColor : null;
        if (color && !(await hasFeature(req.user.id, "customEventThemes"))) continue;
        patch.accentColor = color;
      }
      else patch[key] = req.body[key];
    }
    const updated = await db.update(e.id, patch);
    await db.audit("event.update", { actorId: req.user.id, entityType: "event", entityId: e.id, metadata: patch });

    // Re-score on edits to fields the moderation pipeline actually reasons
    // about — a capacity/price tweak matters, a refund-policy tweak doesn't.
    // The event KEEPS its current discoveryStatus until this finishes (no
    // flicker out of the feed for a minor edit) — see moderation.js design notes.
    const RESCORE_FIELDS = ["title", "blurb", "venue", "area", "price", "startsAt", "cat"];
    if (RESCORE_FIELDS.some((k) => k in patch)) {
      const moderation = await runModerationPipeline(updated, { triggeredBy: "edit" });
      if (!moderation.hardFail) await db.recordModeration(e.id, moderation.moderationResult);
    }

    res.json(await db.get(e.id));
  });

  app.post("/api/events/:id/cancel", requireEventOwner(), async (req, res) => {
    const updated = await db.update(req.event.id, { cancelled: true });
    await db.audit("event.cancel", { actorId: req.user.id, entityType: "event", entityId: req.event.id });
    res.json(updated);
  });

  app.post("/api/events/:id/duplicate", requireEventOwner(), async (req, res) => {
    const e = req.event;
    const nextWeek = new Date(new Date(e.startsAt).getTime() + 7 * 864e5).toISOString();
    const { tiers, ...rest } = e;
    const copy = {
      ...rest, id: slug(e.title) + "-" + crypto.randomUUID().slice(0, 4), sold: 0, cancelled: false, startsAt: nextWeek,
      tiers: tiers ? tiers.map(({ id, ...t }) => t) : null,
    };
    const inserted = await db.insert(copy);
    res.status(201).json(inserted);
  });

  app.get("/api/events/:id/attendees", requireEventAccessOrPermission("viewAttendees"), async (req, res) => {
    res.json(await db.attendeesForEvent(req.event.id));
  });

  // ============================================================
  // Organizer Pro features. Every route below either requires a specific
  // feature flag (requireFeature — see server/features.js) or, for
  // attendee-facing routes like the waitlist join, checks the EVENT
  // OWNER's access rather than the requester's (an anonymous visitor
  // joining a waitlist has no subscription of their own to check).
  // ============================================================

  // ---- Discovery: featured placement / priority ranking ----
  app.patch("/api/events/:id/featured", requireEventOwner(), requireFeature("featuredPlacement"), async (req, res) => {
    const featured = !!req.body?.featured;
    const updated = await prisma.event.update({ where: { id: req.event.id }, data: { featured } });
    await db.audit("event.featured", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { featured } });
    res.json({ id: updated.id, featured: updated.featured });
  });

  // ---- Invite-only hosting: not a Pro feature (no requireFeature) — event
  // creation/publishing/hosting stays free with no gate for every
  // organizer. Turning it on generates a short shareable code (kept, not
  // cleared, when turned back off — so re-enabling doesn't invalidate a
  // link someone already shared without the organizer asking to rotate).
  app.patch("/api/events/:id/invite-only", requireEventOwner(), async (req, res) => {
    const inviteOnly = !!req.body?.inviteOnly;
    const data = { inviteOnly };
    if (inviteOnly && !req.event.inviteCode) {
      data.inviteCode = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8).toUpperCase();
    }
    const updated = await prisma.event.update({ where: { id: req.event.id }, data });
    await db.audit("event.invite_only", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { inviteOnly } });
    res.json({ id: updated.id, inviteOnly: updated.inviteOnly, inviteCode: updated.inviteCode, inviteUrl: `${publicOrigin(req)}/e/${updated.id}?invite=${updated.inviteCode}` });
  });
  // Rotates the code, invalidating every link shared before this call —
  // a deliberate action (someone leaked the old link), not something
  // toggling inviteOnly on/off should ever do automatically.
  app.post("/api/events/:id/invite-only/regenerate", requireEventOwner(), async (req, res) => {
    if (!req.event.inviteOnly) return res.status(400).json({ error: { code: "NOT_INVITE_ONLY", message: "This event isn't invite-only" } });
    const inviteCode = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8).toUpperCase();
    const updated = await prisma.event.update({ where: { id: req.event.id }, data: { inviteCode } });
    await db.audit("event.invite_code_regenerate", { actorId: req.user.id, entityType: "event", entityId: req.event.id });
    res.json({ id: updated.id, inviteCode: updated.inviteCode, inviteUrl: `${publicOrigin(req)}/e/${updated.id}?invite=${updated.inviteCode}` });
  });

  // ---- Marketing: promo codes (covers promoCodes / discountCampaigns /
  // earlyBirdCampaigns — a campaign is a code with a date window, not a
  // separate system) ----
  app.post("/api/events/:id/promo-codes", requireEventOwner(), requireFeature("promoCodes"), async (req, res) => {
    const b = req.body || {};
    const code = String(b.code || "").trim().toUpperCase();
    if (!code || code.length < 3) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Code must be at least 3 characters" } });
    if (!["percent", "flat"].includes(b.discountType)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "discountType must be 'percent' or 'flat'" } });
    const discountValue = Number(b.discountValue);
    if (!Number.isFinite(discountValue) || discountValue <= 0 || (b.discountType === "percent" && discountValue > 100)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid discountValue" } });
    }
    try {
      const created = await prisma.promoCode.create({
        data: {
          eventId: req.event.id, code, discountType: b.discountType, discountValue,
          maxUses: b.maxUses != null ? Math.max(1, parseInt(b.maxUses, 10)) : null,
          startsAt: b.startsAt ? new Date(b.startsAt) : null,
          endsAt: b.endsAt ? new Date(b.endsAt) : null,
          // Group discounts: code only applies at checkout once cart qty
          // reaches this — null/omitted means no minimum, same as before.
          minQuantity: b.minQuantity != null ? Math.max(1, parseInt(b.minQuantity, 10)) : null,
        },
      });
      res.status(201).json(created);
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "That code already exists for this event" } });
      throw err;
    }
  });
  app.get("/api/events/:id/promo-codes", requireEventOwner(), requireFeature("promoCodes"), async (req, res) => {
    res.json(await prisma.promoCode.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "desc" } }));
  });
  app.patch("/api/events/:id/promo-codes/:codeId", requireEventOwner(), requireFeature("promoCodes"), async (req, res) => {
    const existing = await prisma.promoCode.findUnique({ where: { id: req.params.codeId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Promo code not found" } });
    const updated = await prisma.promoCode.update({ where: { id: existing.id }, data: { active: !!req.body?.active } });
    res.json(updated);
  });
  // Public — a buyer redeeming a code at checkout has no subscription of
  // their own; what's gated is CREATING campaigns above, not using one.
  app.post("/api/promo-codes/validate", promoValidateLimiter, async (req, res) => {
    const { eventId, code, qty } = req.body || {};
    if (!eventId || !code) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "eventId and code are required" } });
    const promo = await prisma.promoCode.findUnique({ where: { eventId_code: { eventId, code: String(code).trim().toUpperCase() } } });
    if (!promo || !promo.active) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invalid promo code" } });
    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) return res.status(400).json({ error: { code: "NOT_STARTED", message: "This code isn't active yet" } });
    if (promo.endsAt && promo.endsAt < now) return res.status(400).json({ error: { code: "EXPIRED", message: "This code has expired" } });
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return res.status(400).json({ error: { code: "EXHAUSTED", message: "This code has reached its usage limit" } });
    const cartQty = Math.max(1, Number(qty) || 1);
    if (promo.minQuantity != null && cartQty < promo.minQuantity) {
      return res.status(400).json({ error: { code: "MIN_QUANTITY_NOT_MET", message: `This code requires buying at least ${promo.minQuantity} tickets` } });
    }
    res.json({ code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue, minQuantity: promo.minQuantity });
  });

  // ---- Operations: CSV export ----
  app.get("/api/events/:id/attendees.csv", requireEventOwner(), requireFeature("csvExports"), async (req, res) => {
    const rows = await prisma.booking.findMany({
      where: { eventId: req.event.id, status: "paid" },
      include: { tickets: { select: { code: true, checkedInAt: true } } },
      orderBy: { bookedAt: "asc" },
    });
    // Prefix a leading apostrophe on any value starting with =, +, -, or @ —
    // Excel/Sheets evaluate those as formulas regardless of CSV quoting, so
    // an attendee-supplied name/email at checkout (unvalidated free text)
    // could otherwise run a formula in the organizer's spreadsheet the
    // moment they open this export (classic CSV-injection).
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ["Name,Email,Booked At,Qty,Ticket Code,Checked In"];
    for (const b of rows) {
      const tickets = b.tickets.length ? b.tickets : [{ code: "", checkedInAt: null }];
      for (const t of tickets) {
        lines.push([escape(b.name), escape(b.email), escape(b.bookedAt?.toISOString()), escape(b.qty), escape(t.code), escape(t.checkedInAt ? "yes" : "no")].join(","));
      }
    }
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="attendees-${req.event.id}.csv"`);
    res.send(lines.join("\n"));
  });

  // ---- Operations: waitlist ----
  // Gated on the EVENT OWNER's plan, not the joiner's — an anonymous
  // attendee joining a waitlist has no subscription to check.
  app.post("/api/events/:id/waitlist", socialLimiter, async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    if (!e.ownerId || !(await hasFeature(e.ownerId, "waitlists"))) {
      return res.status(403).json({ error: { code: "FEATURE_LOCKED", message: "This event isn't accepting waitlist signups" } });
    }
    const email = String(req.body?.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email is required" } });
    try {
      const entry = await prisma.waitlistEntry.create({
        data: { eventId: e.id, email, name: req.body?.name ? String(req.body.name).trim() : null, deviceId: req.body?.deviceId || null },
      });
      runEventWorkflows("waitlist_joined", { eventId: e.id, email }).catch(() => {});
      res.status(201).json({ id: entry.id });
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "You're already on the waitlist for this event" } });
      throw err;
    }
  });
  app.get("/api/events/:id/waitlist", requireEventOwner(), requireFeature("waitlists"), async (req, res) => {
    res.json(await prisma.waitlistEntry.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "asc" } }));
  });

  // ---- Marketing: bulk notify attendees (send-now, or scheduled for later
  // via a Campaign row — see runCampaignScan below for the actual send) ----
  app.post("/api/events/:id/notify", socialLimiter, requireEventAccessOrPermission("sendNotifications"), requireFeature("bulkNotifications"), async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!subject || !message) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and message are required" } });
    const scheduledFor = req.body?.scheduledFor ? new Date(req.body.scheduledFor) : null;
    if (scheduledFor && scheduledFor.getTime() > Date.now()) {
      const campaign = await db.createCampaign({ organizerId: req.user.id, eventId: req.event.id, subject, message, scheduledFor });
      return res.status(201).json({ ok: true, scheduled: true, campaign });
    }
    const { recipients, emailed, pushed } = await sendEventNotificationNow(req.event, { subject, message, actorId: req.user.id });
    res.json({ ok: true, recipients, emailed, pushed });
  });
  app.get("/api/events/:id/campaigns", requireEventOwner(), requireFeature("bulkNotifications"), async (req, res) => {
    res.json(await db.listCampaigns(req.event.id));
  });
  app.delete("/api/events/:id/campaigns/:campaignId", requireEventOwner(), requireFeature("bulkNotifications"), async (req, res) => {
    const cancelled = await db.cancelCampaign(req.params.campaignId, req.user.id);
    if (!cancelled) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Nothing to cancel — it may already have sent." } });
    res.json(cancelled);
  });

  // ---- Event Workflows: the organizer-dashboard node-graph automation
  // builder, full parity with the venue side's /api/venues/:id/workflows...
  // (server/venue-workflows.js) but against the event/ticketing catalog in
  // server/event-workflows.js. Executed immediately at the trigger, not
  // polled — see that file's header comment. Cross-event listing lives at
  // GET /api/organizer/workflows (mirrors GET /api/organizer/automations'
  // optional eventId filter) for the Workflows tab's list view; per-event
  // CRUD below backs the graph editor. ----
  app.get("/api/organizer/workflows", requireAuth, requireFeature("eventWorkflows"), async (req, res) => {
    res.json(await prisma.eventWorkflow.findMany({
      where: { organizerId: req.user.id, ...(req.query.eventId ? { eventId: req.query.eventId } : {}) },
      orderBy: { createdAt: "desc" },
    }));
  });

  app.get("/api/events/:id/workflows", requireEventOwner(), requireFeature("eventWorkflows"), async (req, res) => {
    res.json(await prisma.eventWorkflow.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "desc" } }));
  });

  app.post("/api/events/:id/workflows", requireEventOwner(), requireFeature("eventWorkflows"), validateBody(eventWorkflowSchema), async (req, res) => {
    try {
      const { name, nodes, edges } = req.body;
      const invalid = validateEventWorkflowGraph(nodes, edges);
      if (invalid) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: invalid } });
      const workflow = await prisma.eventWorkflow.create({ data: { organizerId: req.user.id, eventId: req.event.id, name, nodes, edges } });
      res.status(201).json(workflow);
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/workflows", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/events/:id/workflows/:workflowId", requireEventOwner(), requireFeature("eventWorkflows"), async (req, res) => {
    try {
      const existing = await prisma.eventWorkflow.findUnique({ where: { id: req.params.workflowId } });
      if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const nodes = req.body?.nodes ?? existing.nodes;
      const edges = req.body?.edges ?? existing.edges;
      const invalid = validateEventWorkflowGraph(nodes, edges);
      if (invalid) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: invalid } });
      const updated = await prisma.eventWorkflow.update({ where: { id: existing.id }, data: { name, nodes, edges } });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "PUT /api/events/:id/workflows/:workflowId", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/events/:id/workflows/:workflowId", requireEventOwner(), requireFeature("eventWorkflows"), async (req, res) => {
    const existing = await prisma.eventWorkflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    const updated = await prisma.eventWorkflow.update({ where: { id: existing.id }, data: { enabled: !!req.body?.enabled } });
    res.json(updated);
  });

  app.delete("/api/events/:id/workflows/:workflowId", requireEventOwner(), requireFeature("eventWorkflows"), async (req, res) => {
    const existing = await prisma.eventWorkflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    await prisma.eventWorkflow.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  app.get("/api/events/:id/workflows/:workflowId/runs", requireEventOwner(), requireFeature("eventWorkflows"), async (req, res) => {
    const existing = await prisma.eventWorkflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    const runs = await prisma.eventWorkflowRun.findMany({ where: { workflowId: existing.id }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json(runs);
  });

  // ---- Team management: recurring events (lightweight — creates N future
  // copies spaced by a fixed interval, reusing the same copy logic as
  // /duplicate; a real recurrence-rule engine (custom weekday patterns,
  // "every 2nd Tuesday", exceptions) is future work, see handoff.md) ----
  app.post("/api/events/:id/recurring", requireEventOwner(), requireFeature("recurringEvents"), async (req, res) => {
    const count = Math.min(52, Math.max(1, parseInt(req.body?.count, 10) || 1));
    const intervalDays = Math.max(1, parseInt(req.body?.intervalDays, 10) || 7);
    const e = req.event;
    const { tiers, ...rest } = e;
    const created = [];
    for (let i = 1; i <= count; i++) {
      const startsAt = new Date(new Date(e.startsAt).getTime() + i * intervalDays * 864e5).toISOString();
      const copy = {
        ...rest, id: slug(e.title) + "-" + crypto.randomUUID().slice(0, 4), sold: 0, cancelled: false, startsAt,
        tiers: tiers ? tiers.map(({ id, ...t }) => t) : null,
      };
      created.push(await db.insert(copy));
    }
    await db.audit("event.recurring", { actorId: req.user.id, entityType: "event", entityId: e.id, metadata: { count, intervalDays } });
    res.status(201).json({ created: created.map((c) => ({ id: c.id, startsAt: c.startsAt })) });
  });

  // ---- reservations (tables/spots at restaurants, cafes, lounges,
  // rooftops, beach clubs, experience venues) — separate from Event/Booking
  // ticketing above. See schema.prisma's Venue/VenueAvailabilitySlot/
  // Reservation comment. ----
  app.get("/api/venues", async (req, res) => {
    try {
      const { category, q } = req.query;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      const where = {};
      if (category && category !== "all") where.category = String(category);
      if (q) {
        const t = String(q);
        where.OR = [
          { name: { contains: t, mode: "insensitive" } },
          { tags: { has: t } },
        ];
      }

      const [venues, total] = await Promise.all([
        prisma.venue.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
        prisma.venue.count({ where }),
      ]);

      res.set('Cache-Control', 'no-store');
      res.json({ venues, page, limit, total, totalPages: Math.ceil(total / limit) });
    } catch (err) {
      captureError(err, { route: "GET /api/venues" });
      res.status(500).json({ error: err.message });
    }
  });

  // MUST be registered before "/api/venues/:id" — otherwise Express matches
  // "mine" as an :id and this never runs (returns 404 from the detail
  // lookup). Venues the signed-in user owns (their hosting dashboard list).
  app.get("/api/venues/mine", requireAuth, async (req, res) => {
    try {
      const venues = await prisma.venue.findMany({
        where: { ownerId: req.user.id },
        include: { _count: { select: { reservations: true, slots: true } } },
        orderBy: { createdAt: "desc" },
      });
      res.json(venues);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/mine" });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id", async (req, res) => {
    try {
      const venue = await prisma.venue.findUnique({
        where: { id: req.params.id },
        include: { slots: true },
      });
      if (!venue) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });
      res.set('Cache-Control', 'no-store');
      res.json(venue);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Owner-editable business profile — everything here already exists on
  // the Venue model but had no update path post-approval; an owner's
  // profile/photos/hours/etc. were permanently frozen at whatever the
  // venue-application captured. Reuses the same magic-byte image
  // validation as the application upload above.
  const VENUE_CATEGORIES = ["restaurant", "cafe", "lounge", "rooftop", "beach_club", "experience"];
  const VENUE_PRICE_RANGES = ["$", "$$", "$$$"];
  app.put("/api/venues/:id", requireAuth, requireVenueOwner, upload.fields([{ name: "coverImage", maxCount: 1 }, { name: "photos", maxCount: 6 }]), async (req, res) => {
    try {
      const b = req.body || {};
      const data = {};
      if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 120);
      if (b.description !== undefined) data.description = String(b.description).trim().slice(0, 2000);
      if (b.category !== undefined) {
        if (!VENUE_CATEGORIES.includes(b.category)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `category must be one of: ${VENUE_CATEGORIES.join(", ")}` } });
        data.category = b.category;
      }
      if (b.venue !== undefined) data.venue = String(b.venue).trim().slice(0, 200);
      if (b.area !== undefined) data.area = String(b.area).trim().slice(0, 100);
      if (b.priceRange !== undefined) {
        if (b.priceRange && !VENUE_PRICE_RANGES.includes(b.priceRange)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `priceRange must be one of: ${VENUE_PRICE_RANGES.join(", ")}` } });
        data.priceRange = b.priceRange || null;
      }
      if (b.tags !== undefined) {
        const tags = typeof b.tags === "string" ? JSON.parse(b.tags) : b.tags;
        data.tags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [];
      }

      async function saveIfImage(file) {
        if (!file) return null;
        const mime = sniffImageMime(file.buffer);
        if (!mime) return null;
        const { url } = await storage.saveImage(file.buffer, EXT_BY_MIME[mime]);
        return url;
      }
      const newCover = await saveIfImage(req.files?.coverImage?.[0]);
      if (newCover) data.coverImage = newCover;

      const newPhotos = [];
      for (const f of (req.files?.photos || [])) {
        const url = await saveIfImage(f);
        if (url) newPhotos.push(url);
      }
      const removePhotos = new Set(
        b.removePhotos ? (typeof b.removePhotos === "string" ? JSON.parse(b.removePhotos) : b.removePhotos) : []
      );
      if (newPhotos.length || removePhotos.size) {
        const kept = req.venue.photos.filter((p) => !removePhotos.has(p));
        data.photos = [...kept, ...newPhotos];
      }

      const updated = await prisma.venue.update({ where: { id: req.venue.id }, data });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/venues/:id/reservations", bookingLimiter, async (req, res) => {
    try {
      const venue = await prisma.venue.findUnique({ where: { id: req.params.id } });
      if (!venue) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });

      const { guestName, guestEmail, guestPhone, partySize, date, time, slotId, notes } = req.body || {};
      if (!guestName || !String(guestName).trim() || !guestEmail || !String(guestEmail).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "guestName and guestEmail are required" } });
      }
      const size = Number(partySize);
      if (!Number.isFinite(size) || size < 1) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "partySize must be a positive number" } });
      }
      if (!date || isNaN(new Date(date).getTime())) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid date is required" } });
      }
      if (!time || !String(time).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "time is required" } });
      }

      let slot = null;
      if (slotId) {
        slot = await prisma.venueAvailabilitySlot.findUnique({ where: { id: slotId } });
        if (!slot || slot.venueId !== venue.id) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid slot for this venue" } });
        }

        // Check party-size sum of confirmed+pending reservations against the
        // slot's capacity for that date, before accepting a new reservation —
        // rejects with 409 rather than silently overbooking the slot.
        const requestedDate = new Date(date);
        const dayStart = new Date(Date.UTC(requestedDate.getUTCFullYear(), requestedDate.getUTCMonth(), requestedDate.getUTCDate()));
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
        const existing = await prisma.reservation.findMany({
          where: {
            slotId: slot.id,
            status: { in: ["pending", "confirmed"] },
            date: { gte: dayStart, lt: dayEnd },
          },
        });
        const bookedCount = existing.reduce((sum, r) => sum + r.partySize, 0);
        if (bookedCount + size > slot.capacity) {
          return res.status(409).json({ error: { code: "CAPACITY_EXCEEDED", message: "This slot doesn't have enough capacity left for that party size" } });
        }
      }

      const reservation = await prisma.reservation.create({
        data: {
          venueId: venue.id,
          slotId: slot ? slot.id : null,
          guestName: String(guestName).trim(),
          guestEmail: String(guestEmail).trim(),
          guestPhone: guestPhone ? String(guestPhone).trim() : null,
          partySize: size,
          date: new Date(date),
          time: String(time).trim(),
          notes: notes ? String(notes).trim() : null,
        },
      });
      await autoAssignTable(reservation);
      runVenueWorkflows("reservation_created", reservation).catch(() => {});
      trackEvent(req.user?.id || guestEmail, "reservation_created", { venueId: venue.id, partySize: size });
      res.status(201).json(reservation);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/reservations", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- venue reservation waitlist (distinct from the per-event
  // WaitlistEntry in server/event-workflows.js — see that model's schema
  // comment). Public: a guest joins a specific venue's waitlist for a
  // requested date/time when every slot is full, no account required. ----
  app.post("/api/venues/:id/waitlist", bookingLimiter, async (req, res) => {
    try {
      const venue = await prisma.venue.findUnique({ where: { id: req.params.id } });
      if (!venue) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });

      const { guestName, guestEmail, guestPhone, partySize, requestedDate, requestedTimeWindow, notes } = req.body || {};
      if (!guestName || !String(guestName).trim() || !guestEmail || !String(guestEmail).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "guestName and guestEmail are required" } });
      }
      const size = Number(partySize);
      if (!Number.isFinite(size) || size < 1) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "partySize must be a positive number" } });
      }
      if (!requestedDate || isNaN(new Date(requestedDate).getTime())) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid requestedDate is required" } });
      }
      if (!requestedTimeWindow || !String(requestedTimeWindow).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "requestedTimeWindow is required" } });
      }

      const entry = await prisma.venueWaitlistEntry.create({
        data: {
          venueId: venue.id,
          guestName: String(guestName).trim(),
          guestEmail: String(guestEmail).trim(),
          guestPhone: guestPhone ? String(guestPhone).trim() : null,
          partySize: size,
          requestedDate: new Date(requestedDate),
          requestedTimeWindow: String(requestedTimeWindow).trim(),
          notes: notes ? String(notes).trim() : null,
        },
      });
      trackEvent(req.user?.id || guestEmail, "venue_waitlist_joined", { venueId: venue.id, partySize: size });
      res.status(201).json(entry);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/waitlist", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // reservations the signed-in user made — matched by their account email,
  // mirroring how GET /api/dashboard/events filters by req.user.id but
  // keyed on guestEmail since Reservation has no userId column
  app.get("/api/reservations/mine", requireAuth, async (req, res) => {
    try {
      const reservations = await prisma.reservation.findMany({
        where: { guestEmail: req.user.email },
        include: { venue: true, slot: true },
        orderBy: { date: "desc" },
      });
      res.json(reservations);
    } catch (err) {
      captureError(err, { route: "GET /api/reservations/mine" });
      res.status(500).json({ error: err.message });
    }
  });

  // host-only venue creation — mirrors POST /api/events: any signed-in user
  // may create one (ownerId is set to req.user.id), no separate role gate.
  app.post("/api/venues", createEventLimiter, requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const ALLOWED_CATEGORIES = ["restaurant", "cafe", "lounge", "rooftop", "beach_club", "experience"];
      if (!b.name || !String(b.name).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      }
      if (!ALLOWED_CATEGORIES.includes(b.category)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `category must be one of: ${ALLOWED_CATEGORIES.join(", ")}` } });
      }
      if (!b.venue || !String(b.venue).trim() || !b.area || !String(b.area).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "venue and area are required" } });
      }

      const venue = await prisma.venue.create({
        data: {
          name: String(b.name).trim(),
          category: b.category,
          description: (b.description || "").trim(),
          venue: String(b.venue).trim(),
          area: String(b.area).trim(),
          lat: b.lat ? Number(b.lat) : 23.6100,
          lng: b.lng ? Number(b.lng) : 58.5400,
          distanceKm: Number(b.distanceKm) || +(Math.random() * 8 + 1).toFixed(1),
          coverImage: b.coverImage || null,
          photos: Array.isArray(b.photos) ? b.photos : [],
          priceRange: ["$", "$$", "$$$"].includes(b.priceRange) ? b.priceRange : null,
          tags: Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(",").map((t) => t.trim()).filter(Boolean) : []),
          ownerId: req.user.id,
        },
      });
      trackEvent(req.user.id, "venue_create", { venueId: venue.id, category: venue.category });
      res.status(201).json(venue);
    } catch (err) {
      captureError(err, { route: "POST /api/venues" });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- venue reservation-hosting applications (manual review, not
  // self-serve — see prisma/schema.prisma's VenueApplication comment).
  // Public: an applicant doesn't need a Weyn account to apply. ----
  app.post("/api/venue-applications", applicationLimiter, upload.fields([{ name: "proofDoc", maxCount: 1 }, { name: "coverImage", maxCount: 1 }, { name: "photos", maxCount: 6 }]), async (req, res) => {
    try {
      const b = req.body || {};
      const ALLOWED_TYPES = ["restaurant", "cafe", "lounge", "rooftop", "beach_club", "experience"];
      if (!ALLOWED_TYPES.includes(b.businessType)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `businessType must be one of: ${ALLOWED_TYPES.join(", ")}` } });
      }
      if (!b.name || !String(b.name).trim() || !b.contactName || !String(b.contactName).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and contactName are required" } });
      }
      if (!b.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.contactEmail).trim())) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid contactEmail is required" } });
      }
      // Ownership proof is mandatory — a venue can't be listed on someone
      // else's behalf. The applicant declares their role and uploads a photo
      // of a trade licence / commercial registration / authorization letter.
      const ALLOWED_ROLES = ["owner", "manager", "authorized"];
      if (!ALLOWED_ROLES.includes(b.role)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Tell us your role at the venue (owner, manager, or authorized)" } });
      }
      const proofFile = req.files?.proofDoc?.[0];
      if (!proofFile) {
        return res.status(400).json({ error: { code: "PROOF_REQUIRED", message: "Upload a photo of your trade licence, commercial registration, or an authorization letter to verify you operate this venue." } });
      }

      // Save uploads (proof doc, cover, gallery) — all image uploads, magic-
      // byte sniffed like every other upload path (no trusting Content-Type).
      async function saveIfImage(file) {
        if (!file) return null;
        const mime = sniffImageMime(file.buffer);
        if (!mime) return null;
        const { url } = await storage.saveImage(file.buffer, EXT_BY_MIME[mime]);
        return url;
      }
      const proofDocUrl = await saveIfImage(proofFile);
      if (!proofDocUrl) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "The proof document must be a clear photo (PNG/JPEG/WEBP)." } });
      }
      const coverImage = await saveIfImage(req.files?.coverImage?.[0]);
      const photos = [];
      for (const f of (req.files?.photos || [])) {
        const url = await saveIfImage(f);
        if (url) photos.push(url);
      }

      const application = await prisma.venueApplication.create({
        data: {
          applicantId: req.user?.id || null,
          businessType: b.businessType,
          name: String(b.name).trim(),
          contactName: String(b.contactName).trim(),
          contactEmail: String(b.contactEmail).trim(),
          contactPhone: b.contactPhone ? String(b.contactPhone).trim() : null,
          description: b.description ? String(b.description).trim() : null,
          venue: b.venue ? String(b.venue).trim() : null,
          area: b.area ? String(b.area).trim() : null,
          lat: b.lat != null && b.lat !== "" ? Number(b.lat) : null,
          lng: b.lng != null && b.lng !== "" ? Number(b.lng) : null,
          coverImage,
          photos,
          role: b.role,
          businessRegNo: b.businessRegNo ? String(b.businessRegNo).trim() : null,
          proofDocUrl,
          guestTags: (() => { try { return Array.isArray(b.guestTags) ? b.guestTags : JSON.parse(b.guestTags || "[]"); } catch { return String(b.guestTags || "").split(",").map((t) => t.trim()).filter(Boolean); } })(),
          priceRange: ["$", "$$", "$$$"].includes(b.priceRange) ? b.priceRange : null,
          subscriptionTier: ["basic", "growth", "premium"].includes(b.subscriptionTier) ? b.subscriptionTier : null,
          // Step-6 schedule, validated the same way setVenueSlots validates a
          // live venue's slots — this is what approval turns into real
          // VenueAvailabilitySlot rows, so a malformed entry here would
          // otherwise surface as a crash at approval time instead of now.
          availability: (() => {
            let raw;
            try { raw = JSON.parse(b.availability || "[]"); } catch { return null; }
            if (!Array.isArray(raw)) return null;
            const clean = raw.filter((s) =>
              s && Number.isInteger(s.dayOfWeek) && s.dayOfWeek >= 0 && s.dayOfWeek <= 6 &&
              typeof s.startTime === "string" && /^\d{2}:\d{2}$/.test(s.startTime) &&
              typeof s.endTime === "string" && /^\d{2}:\d{2}$/.test(s.endTime) &&
              Number.isInteger(s.capacity) && s.capacity > 0
            ).map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity }));
            return clean.length ? clean : null;
          })(),
        },
      });

      // Email is best-effort — the application is already durably stored
      // above, so a Resend outage never loses a submission, only delays
      // the team noticing it (see server/email.js: silent no-op if
      // RESEND_API_KEY isn't set at all).
      const notifyTo = process.env.VENUE_APPLICATION_NOTIFY_EMAIL;
      if (!notifyTo) {
        console.warn("[weyn] VENUE_APPLICATION_NOTIFY_EMAIL unset — venue-application notification email skipped (application still stored).");
      }
      // Every field below is applicant-controlled from an UNAUTHENTICATED
      // POST /api/venue-applications — escape all of them (security audit).
      const e = (v, fallback = "—") => escapeHtml(v || fallback);
      if (notifyTo) sendEmail({
        to: notifyTo,
        subject: `New venue application: ${application.name}`,
        html: `
          <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 12px">New reservation-hosting application</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#222">
              <tr><td style="padding:6px 0;color:#888">Venue</td><td style="padding:6px 0"><b>${e(application.name)}</b></td></tr>
              <tr><td style="padding:6px 0;color:#888">Type</td><td style="padding:6px 0">${e(application.businessType)}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Area</td><td style="padding:6px 0">${e(application.area)}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Contact</td><td style="padding:6px 0">${e(application.contactName)} (${e(application.role)})</td></tr>
              <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${e(application.contactEmail)}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${e(application.contactPhone)}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Address</td><td style="padding:6px 0">${e(application.venue)}${application.area ? ", " + escapeHtml(application.area) : ""}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Reg. no.</td><td style="padding:6px 0">${e(application.businessRegNo)}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Price range</td><td style="padding:6px 0">${e(application.priceRange)}</td></tr>
              <tr><td style="padding:6px 0;color:#888;vertical-align:top">Description</td><td style="padding:6px 0">${e(application.description)}</td></tr>
            </table>
            <p style="margin:18px 0 6px"><a href="${(process.env.PUBLIC_APP_URL || "https://weynevents.com").replace(/\/$/, "")}${application.proofDocUrl}" style="color:#1C6DD0">View ownership proof document →</a></p>
            <p style="margin:0"><a href="${(process.env.PUBLIC_APP_URL || "https://weynevents.com").replace(/\/$/, "")}/admin" style="color:#1C6DD0">Review &amp; approve in the admin queue →</a></p>
            <p style="color:#888;font-size:12px;margin-top:20px">Application ID: ${application.id}</p>
          </div>
        `,
      }).catch((err) => captureError(err, { route: "POST /api/venue-applications (email)", applicationId: application.id }));

      trackEvent(null, "venue_application_submitted", { applicationId: application.id, businessType: application.businessType });
      res.status(201).json({ id: application.id, status: application.status });
    } catch (err) {
      captureError(err, { route: "POST /api/venue-applications" });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- venue owner management (dashboard for an approved venue) ----
  // Loads req.params.id's Venue and 403s unless the signed-in user owns it
  // or is an ADMIN — the venue equivalent of requireEventOwner.
  async function requireVenueOwner(req, res, next) {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    const venue = await prisma.venue.findUnique({ where: { id: req.params.id } });
    if (!venue) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Venue not found" } });
    if (venue.ownerId !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this venue" } });
    }
    req.venue = venue;
    next();
  }

  // Venues the signed-in user owns (their reservation-hosting dashboard list).
  // Incoming reservations for one of my venues, newest first.
  app.get("/api/venues/:id/reservations", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const reservations = await prisma.reservation.findMany({
        where: { venueId: req.venue.id },
        include: { slot: true, tableAssignment: { include: { tables: { include: { table: true } } } } },
        orderBy: [{ date: "asc" }, { createdAt: "desc" }],
      });
      res.json(reservations);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/reservations", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Replace a venue's weekly availability in one call (owner sets their
  // bookable slots). Deletes the old set and writes the new — simplest
  // correct model for "here is my current weekly schedule".
  app.put("/api/venues/:id/slots", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.slots) ? req.body.slots : [];
      const clean = [];
      for (const s of incoming) {
        const dayOfWeek = Number(s.dayOfWeek);
        const capacity = Number(s.capacity);
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;
        if (!/^\d{2}:\d{2}$/.test(String(s.startTime)) || !/^\d{2}:\d{2}$/.test(String(s.endTime))) continue;
        if (!Number.isFinite(capacity) || capacity < 1) continue;
        clean.push({ venueId: req.venue.id, dayOfWeek, startTime: String(s.startTime), endTime: String(s.endTime), capacity: Math.floor(capacity) });
      }
      await prisma.$transaction([
        prisma.venueAvailabilitySlot.deleteMany({ where: { venueId: req.venue.id } }),
        ...(clean.length ? [prisma.venueAvailabilitySlot.createMany({ data: clean })] : []),
      ]);
      const slots = await prisma.venueAvailabilitySlot.findMany({ where: { venueId: req.venue.id }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
      res.json({ slots });
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id/slots", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Owner confirms/cancels/seats/no-shows a reservation for their venue.
  // "seated"/"no_show" are terminal, post-arrival outcomes — distinct from
  // "confirmed" (accepted, hasn't happened yet) — and back the analytics
  // endpoint's no-show rate below.
  app.post("/api/reservations/:id/status", requireAuth, async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      if (!["confirmed", "cancelled", "seated", "no_show"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be 'confirmed', 'cancelled', 'seated', or 'no_show'" } });
      }
      const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { venue: true } });
      if (!reservation) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Reservation not found" } });
      if (reservation.venue.ownerId !== req.user.id && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this venue" } });
      }
      const updated = await prisma.reservation.update({ where: { id: reservation.id }, data: { status } });
      if (status === "cancelled") {
        runVenueWorkflows("reservation_cancelled", updated).catch(() => {});
        notifyNextWaitlistEntry(updated).catch((err) => captureError(err, { route: "notifyNextWaitlistEntry", reservationId: updated.id }));
      }
      if (status === "no_show") runVenueWorkflows("guest_no_show", updated).catch(() => {});
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "POST /api/reservations/:id/status", reservationId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Owner-entered reservation — phone bookings, walk-ins — created directly
  // from the dashboard rather than a guest submitting the public form.
  // Auto-confirmed (the owner is asserting it happened/will happen) and
  // deliberately skips the capacity-vs-slot check the public route enforces:
  // an owner seating a walk-in without a matching slot, or over a slot's
  // nominal capacity for a one-off, is a real and common case they should be
  // able to just record.
  app.post("/api/venues/:id/reservations/manual", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const { guestName, guestEmail, guestPhone, partySize, date, time, slotId, notes, status } = req.body || {};
      if (!guestName || !String(guestName).trim() || !guestEmail || !String(guestEmail).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "guestName and guestEmail are required" } });
      }
      const size = Number(partySize);
      if (!Number.isFinite(size) || size < 1) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "partySize must be a positive number" } });
      }
      if (!date || isNaN(new Date(date).getTime())) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid date is required" } });
      }
      if (!time || !String(time).trim()) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "time is required" } });
      }
      let slot = null;
      if (slotId) {
        slot = await prisma.venueAvailabilitySlot.findUnique({ where: { id: slotId } });
        if (!slot || slot.venueId !== req.venue.id) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid slot for this venue" } });
        }
      }
      const finalStatus = ["confirmed", "seated"].includes(status) ? status : "confirmed";
      const reservation = await prisma.reservation.create({
        data: {
          venueId: req.venue.id,
          slotId: slot ? slot.id : null,
          guestName: String(guestName).trim(),
          guestEmail: String(guestEmail).trim(),
          guestPhone: guestPhone ? String(guestPhone).trim() : null,
          partySize: size,
          date: new Date(date),
          time: String(time).trim(),
          notes: notes ? String(notes).trim() : null,
          status: finalStatus,
          source: "manual",
        },
      });
      await autoAssignTable(reservation);
      runVenueWorkflows("reservation_created", reservation).catch(() => {});
      res.status(201).json(reservation);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/reservations/manual", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- venue waitlist: owner dashboard management ----
  // Pending-first (WAITING/NOTIFIED before CONVERTED/EXPIRED/CANCELLED),
  // then oldest requested date, mirroring how the reservations list
  // orders by date first — a venue owner wants "who's next" at a glance.
  app.get("/api/venues/:id/waitlist", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const entries = await prisma.venueWaitlistEntry.findMany({
        where: { venueId: req.venue.id },
        orderBy: [{ priority: "desc" }, { requestedDate: "asc" }, { createdAt: "asc" }],
      });
      res.json(entries);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/waitlist", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Owner tells a waiting guest a table is (probably) about to open up —
  // sends the notification email and flips WAITING -> NOTIFIED. Doesn't
  // create a reservation yet; the guest (or the owner, on their behalf)
  // still needs to actually convert via the promote route below.
  app.post("/api/venues/:id/waitlist/:entryId/notify", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const entry = await prisma.venueWaitlistEntry.findUnique({ where: { id: req.params.entryId } });
      if (!entry || entry.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Waitlist entry not found" } });
      if (entry.status !== "WAITING") {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Only a WAITING entry can be notified" } });
      }
      const updated = await prisma.venueWaitlistEntry.update({ where: { id: entry.id }, data: { status: "NOTIFIED", notifiedAt: new Date() } });
      // Escape every interpolated field: guestName/guestEmail come from an
      // UNAUTHENTICATED public waitlist-join (the joiner can put arbitrary
      // HTML in guestName and an arbitrary victim address in guestEmail), and
      // venue.name can itself trace back to an unescaped venue application —
      // so raw interpolation here let a joiner deliver arbitrary HTML to any
      // address under Weyn's trusted sending domain. (Security audit: High.)
      const firstName = escapeHtml(entry.guestName.split(" ")[0] || "there");
      const venueName = escapeHtml(req.venue.name);
      const timeWindow = escapeHtml(entry.requestedTimeWindow);
      const partySize = Number(entry.partySize) || 0;
      sendEmail({
        to: entry.guestEmail,
        subject: `${req.venue.name}: A table may be opening up`,
        html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">Good news, ${firstName}</h2><p style="line-height:1.5;color:#222">A table may be opening up at ${venueName} for your party of ${partySize} around ${timeWindow} on ${entry.requestedDate.toISOString().slice(0, 10)}. Reply or call to confirm and we'll get you seated.</p></div>`,
      }).catch((err) => captureError(err, { route: "POST /api/venues/:id/waitlist/:entryId/notify (email)", entryId: entry.id }));
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/waitlist/:entryId/notify", venueId: req.params.id, entryId: req.params.entryId });
      res.status(500).json({ error: err.message });
    }
  });

  // Promotes a waitlist entry into a real Reservation (auto-confirmed, same
  // as a manual/owner-entered booking — see /reservations/manual above) and
  // marks the entry CONVERTED. Reuses autoAssignTable/runVenueWorkflows so a
  // promoted reservation behaves identically to any other reservation from
  // here on — no parallel state machine.
  app.post("/api/venues/:id/waitlist/:entryId/promote", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const entry = await prisma.venueWaitlistEntry.findUnique({ where: { id: req.params.entryId } });
      if (!entry || entry.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Waitlist entry not found" } });
      if (!["WAITING", "NOTIFIED"].includes(entry.status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Only a WAITING or NOTIFIED entry can be promoted" } });
      }
      const b = req.body || {};
      const time = b.time ? String(b.time).trim() : String(entry.requestedTimeWindow).trim();
      const reservation = await prisma.reservation.create({
        data: {
          venueId: req.venue.id,
          slotId: b.slotId || null,
          guestName: entry.guestName,
          guestEmail: entry.guestEmail,
          guestPhone: entry.guestPhone,
          partySize: entry.partySize,
          date: entry.requestedDate,
          time,
          notes: entry.notes,
          status: "confirmed",
          source: "manual",
        },
      });
      await autoAssignTable(reservation);
      runVenueWorkflows("reservation_created", reservation).catch(() => {});
      const updated = await prisma.venueWaitlistEntry.update({
        where: { id: entry.id },
        data: { status: "CONVERTED", convertedReservationId: reservation.id },
      });
      res.json({ entry: updated, reservation });
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/waitlist/:entryId/promote", venueId: req.params.id, entryId: req.params.entryId });
      res.status(500).json({ error: err.message });
    }
  });

  // Owner (or the guest cancelling their own spot) removes an entry —
  // CANCELLED rather than a hard delete, so the dashboard can still show
  // "why isn't this guest waiting anymore" in a history view later.
  app.delete("/api/venues/:id/waitlist/:entryId", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const entry = await prisma.venueWaitlistEntry.findUnique({ where: { id: req.params.entryId } });
      if (!entry || entry.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Waitlist entry not found" } });
      const updated = await prisma.venueWaitlistEntry.update({ where: { id: entry.id }, data: { status: "CANCELLED" } });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "DELETE /api/venues/:id/waitlist/:entryId", venueId: req.params.id, entryId: req.params.entryId });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- venue analytics: covers seated, no-show rate, peak hours/days ----
  // Revenue is deliberately not included — Reservation has no monetary field
  // (no deposit/prepayment exists yet), so a revenue figure here would be
  // fabricated rather than measured.
  app.get("/api/venues/:id/analytics", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const reservations = await prisma.reservation.findMany({ where: { venueId: req.venue.id } });
      const total = reservations.length;
      const seated = reservations.filter((r) => r.status === "seated");
      const noShows = reservations.filter((r) => r.status === "no_show");
      const arrived = seated.length + noShows.length; // reservations with a known post-arrival outcome
      const coversSeated = seated.reduce((sum, r) => sum + r.partySize, 0);
      const noShowRate = arrived > 0 ? noShows.length / arrived : null;

      const byHour = {};
      const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0];
      for (const r of reservations) {
        if (r.status === "cancelled") continue;
        const hour = String(r.time || "").slice(0, 2);
        if (hour) byHour[hour] = (byHour[hour] || 0) + 1;
        byDayOfWeek[new Date(r.date).getUTCDay()] += 1;
      }
      const peakHours = Object.entries(byHour).sort(([, a], [, b]) => b - a).slice(0, 5).map(([hour, count]) => ({ hour: `${hour}:00`, count }));

      res.json({
        totalReservations: total,
        coversSeated,
        noShows: noShows.length,
        noShowRate,
        peakHours,
        byDayOfWeek,
      });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/analytics", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- per-guest notes: a running note per (venue, guestEmail), independent
  // of any single reservation. List is owner-only same as reservations. ----
  app.get("/api/venues/:id/guest-notes", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const notes = await prisma.venueGuestNote.findMany({ where: { venueId: req.venue.id } });
      res.json(notes);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/guest-notes", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/venues/:id/guest-notes/:email", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const guestEmail = String(req.params.email || "").trim().toLowerCase();
      const note = String(req.body?.note || "").trim();
      const tags = Array.isArray(req.body?.tags) ? [...new Set(req.body.tags.map((t) => String(t).trim()).filter(Boolean))] : undefined;
      if (!guestEmail) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "guestEmail is required" } });
      if (!note && (!tags || tags.length === 0)) {
        await prisma.venueGuestNote.deleteMany({ where: { venueId: req.venue.id, guestEmail } });
        return res.json({ deleted: true });
      }
      const saved = await prisma.venueGuestNote.upsert({
        where: { venueId_guestEmail: { venueId: req.venue.id, guestEmail } },
        create: { venueId: req.venue.id, guestEmail, note, tags: tags || [] },
        update: { note, ...(tags ? { tags } : {}) },
      });
      res.json(saved);
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id/guest-notes/:email", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Venue Marketing: send-now/scheduled campaigns to a segment of a
  // venue's guests. Mirrors the event-side Messaging Center (same Campaign
  // model, same "send now vs create as scheduled" branch, same
  // runCampaignScan picking up anything with a future scheduledFor) — see
  // that route's comment for why scheduling reuses a Campaign row instead
  // of a separate job queue. ----
  app.get("/api/venues/:id/segment-preview", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const segment = { type: req.query.type || "all", tag: req.query.tag, days: req.query.days ? Number(req.query.days) : undefined };
      const guests = await resolveVenueSegment(req.venue.id, segment);
      res.json({ count: guests.length, sample: guests.slice(0, 5).map((g) => g.name) });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/segment-preview", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/venues/:id/campaigns", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const subject = String(req.body?.subject || "").trim();
      const message = String(req.body?.message || "").trim();
      if (!subject || !message) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and message are required" } });
      const segment = req.body?.segment && typeof req.body.segment === "object" ? req.body.segment : { type: "all" };
      const scheduledFor = req.body?.scheduledFor ? new Date(req.body.scheduledFor) : null;

      if (scheduledFor && scheduledFor.getTime() > Date.now()) {
        const campaign = await db.createCampaign({ organizerId: req.user.id, venueId: req.venue.id, subject, message, segment, scheduledFor });
        return res.status(201).json({ ok: true, scheduled: true, campaign });
      }

      const guests = await resolveVenueSegment(req.venue.id, segment);
      const safeSubject = escapeHtml(subject);
      const safeMessage = escapeHtml(message);
      const safeVenueName = escapeHtml(req.venue.name);
      let emailed = 0;
      await Promise.all(guests.map((g) =>
        sendEmail({
          to: g.email,
          subject: `${req.venue.name}: ${subject}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you've booked with ${safeVenueName}.</p></div>`,
        }).then(() => emailed++).catch((err) => captureError(err, { route: "POST /api/venues/:id/campaigns", venueId: req.venue.id }))
      ));
      const campaign = await db.createCampaign({ organizerId: req.user.id, venueId: req.venue.id, subject, message, segment, scheduledFor: null, recipientCount: emailed });
      if (guests.length) {
        await prisma.venueCampaignRecipient.createMany({ data: guests.map((g) => ({ campaignId: campaign.id, guestEmail: g.email })) }).catch((err) => captureError(err, { route: "POST /api/venues/:id/campaigns:recipients", venueId: req.venue.id }));
      }
      res.status(201).json({ ok: true, scheduled: false, recipients: guests.length, emailed, campaign });
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/campaigns", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id/campaigns", requireAuth, requireVenueOwner, async (req, res) => {
    res.json(await db.listVenueCampaigns(req.venue.id));
  });

  // AI-drafted campaign copy — the marketing-copywriting principles this
  // is built on (benefit-first framing, one clear angle/hook, never invent
  // urgency/stats/social proof that isn't real) rather than pulling in a
  // generic "write me an email" prompt. Always a draft the owner reviews
  // and edits before sending — never auto-sent, same policy as every
  // other AI Studio feature in this app.
  app.post("/api/venues/:id/campaigns/ai-draft", importLimiter, requireAuth, requireVenueOwner, requireFeature("aiStudio"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "No AI provider key is set on this server yet." } });
    const goal = String(req.body?.goal || "").trim();
    if (!goal) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Describe what this campaign should achieve." } });
    const segmentLabel = String(req.body?.segmentLabel || "your guests").trim();
    const brandKit = await prisma.venueBrandKit.findUnique({ where: { venueId: req.venue.id } });
    const prompt = `You are an expert direct-response copywriter, writing one short marketing email on behalf of a real venue.

Venue: ${req.venue.name}, a ${req.venue.category.replace("_", " ")} in ${req.venue.area}, Oman.
Audience: ${segmentLabel} (an existing guest list — not cold outreach).
Goal: ${goal}
${brandKitLine(brandKit)}

Rules, non-negotiable:
- Benefit-first, not feature-first — lead with what's in it for the guest, not a description of the venue.
- One clear angle/hook. Don't try to say three things at once.
- Never invent statistics, urgency ("only 3 spots left"), or social proof ("hundreds of happy guests") that isn't verifiably true — if you don't have a real number, don't use a fake one.
- Warm, direct, human tone. No corporate voice ("we are pleased to announce"), no excessive exclamation points.
- Subject line under 60 characters. Message body under 120 words, plain text (no markdown).

Return strict JSON only, no other text: {"subject": "...", "message": "..."}`;
    try {
      const draft = await askClaudeJson(prompt, { maxTokens: 400 });
      await db.logAiGeneration({ organizerId: req.user.id, eventId: null, feature: "venue-campaign-draft", prompt, output: JSON.stringify(draft) });
      res.json(draft);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/campaigns/ai-draft", venueId: req.params.id });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't draft that right now — try again shortly." } });
    }
  });

  app.delete("/api/venues/:id/campaigns/:campaignId", requireAuth, requireVenueOwner, async (req, res) => {
    const cancelled = await db.cancelCampaign(req.params.campaignId, req.user.id);
    if (!cancelled) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Nothing to cancel — it may already have sent." } });
    res.json(cancelled);
  });

  // ---- Venue Marketing Hub: win-back conversion tracking ----
  // "Did a guest we targeted with a lapsed-guest win-back campaign actually
  // book again" — computed from the VenueCampaignRecipient snapshot taken
  // at send time (see the campaigns routes above), not re-resolved from the
  // segment (which would drift as guest history keeps changing).
  app.get("/api/venues/:id/campaigns/:campaignId/winback-stats", requireAuth, requireVenueOwner, requireFeature("venueWinBackCampaigns"), async (req, res) => {
    try {
      const campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
      if (!campaign || campaign.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
      const windowDays = req.query.windowDays ? Math.max(1, Number(req.query.windowDays)) : 30;
      const recipients = await prisma.venueCampaignRecipient.findMany({ where: { campaignId: campaign.id } });
      const stats = await winBackConversion(req.venue.id, campaign, recipients, windowDays);
      res.json(stats);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/campaigns/:campaignId/winback-stats", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Venue Marketing Hub: loyalty / referral tracking ----
  // Punch-card-style visit tiers (bronze/silver/gold), computed live from
  // Reservation history — never stored, so it can't drift. Only the
  // referral code (needs to stay stable once shared) is persisted, in
  // VenueLoyalty. No payment/discount processing.
  app.get("/api/venues/:id/loyalty", requireAuth, requireVenueOwner, requireFeature("venueLoyaltyProgram"), async (req, res) => {
    try {
      const [visits, loyaltyRows] = await Promise.all([
        venueGuestVisitCounts(req.venue.id),
        prisma.venueLoyalty.findMany({ where: { venueId: req.venue.id } }),
      ]);
      const byEmail = new Map(loyaltyRows.map((l) => [l.guestEmail.toLowerCase(), l]));
      const guests = visits
        .map((g) => {
          const loyalty = byEmail.get(g.email.toLowerCase());
          return {
            email: g.email,
            name: g.name,
            visits: g.visits,
            lastVisit: g.lastVisit,
            tier: loyaltyTierForVisits(g.visits),
            referralCode: loyalty?.referralCode || null,
            referralCount: loyalty?.referralCount || 0,
          };
        })
        .sort((a, b) => b.visits - a.visits);
      res.json({ tiers: LOYALTY_TIERS, guests });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/loyalty", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Issue (or return the existing) referral code for a guest — idempotent,
  // short URL-safe code, same collision-retry pattern as the organizer
  // side's ReferralCode.
  app.post("/api/venues/:id/loyalty/:email/referral-code", requireAuth, requireVenueOwner, requireFeature("venueLoyaltyProgram"), async (req, res) => {
    try {
      const guestEmail = String(req.params.email || "").trim().toLowerCase();
      if (!guestEmail) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "guestEmail is required" } });
      const existing = await prisma.venueLoyalty.findUnique({ where: { venueId_guestEmail: { venueId: req.venue.id, guestEmail } } });
      if (existing) return res.json(existing);
      let code;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = crypto.randomBytes(4).toString("hex").toUpperCase();
        const clash = await prisma.venueLoyalty.findUnique({ where: { referralCode: code } });
        if (!clash) break;
      }
      const created = await prisma.venueLoyalty.create({ data: { venueId: req.venue.id, guestEmail, referralCode: code } });
      res.status(201).json(created);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/loyalty/:email/referral-code", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Venue Marketing Hub: UTM link builder ----
  app.post("/api/venues/:id/marketing-links", requireAuth, requireVenueOwner, requireFeature("venueUtmLinkBuilder"), async (req, res) => {
    try {
      const b = req.body || {};
      const label = String(b.label || "").trim();
      const utmSource = String(b.utmSource || "").trim();
      const utmMedium = String(b.utmMedium || "").trim();
      const utmCampaign = String(b.utmCampaign || "").trim();
      if (!label || !utmSource || !utmMedium || !utmCampaign) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "label, utmSource, utmMedium, and utmCampaign are all required" } });
      }
      const params = new URLSearchParams({ utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign });
      const url = `${req.protocol}://${req.get("host")}/venues/${req.venue.id}?${params.toString()}`;
      const created = await prisma.venueMarketingLink.create({
        data: { venueId: req.venue.id, label, utmSource, utmMedium, utmCampaign, url },
      });
      res.status(201).json(created);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/marketing-links", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/venues/:id/marketing-links", requireAuth, requireVenueOwner, requireFeature("venueUtmLinkBuilder"), async (req, res) => {
    res.json(await prisma.venueMarketingLink.findMany({ where: { venueId: req.venue.id }, orderBy: { createdAt: "desc" } }));
  });
  app.delete("/api/venues/:id/marketing-links/:linkId", requireAuth, requireVenueOwner, requireFeature("venueUtmLinkBuilder"), async (req, res) => {
    const existing = await prisma.venueMarketingLink.findUnique({ where: { id: req.params.linkId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Link not found" } });
    await prisma.venueMarketingLink.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // ---- Venue Marketing Hub: marketing calendar ----
  // Every venue this owner manages, one combined calendar of sent/scheduled
  // campaigns plus a recurring weekly promo reminder ("happy hour every
  // Friday") the owner can add — purely a client-visible reminder list
  // (VenueRecurringPromo), no automatic send; if they want it to actually
  // go out on a schedule, that's what Workflows/scheduled campaigns are for.
  app.get("/api/venues/:id/marketing-calendar", requireAuth, requireVenueOwner, requireFeature("venueMarketingCalendar"), async (req, res) => {
    try {
      const campaigns = await prisma.campaign.findMany({
        where: { venueId: req.venue.id, status: { in: ["scheduled", "sent"] } },
        orderBy: [{ scheduledFor: "asc" }, { sentAt: "asc" }],
      });
      const items = campaigns.map((c) => ({
        id: c.id,
        kind: "campaign",
        subject: c.subject,
        status: c.status,
        date: c.status === "sent" ? c.sentAt : c.scheduledFor,
      }));
      items.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      res.json(items);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/marketing-calendar", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Venue Marketing Hub: brand kit ----
  // Same shape/pattern as the organizer side's /api/me/brand-kit, keyed by
  // venueId instead of organizerId (see prisma/schema.prisma's
  // VenueBrandKit comment for why). Feeds into the venue AI campaign-draft
  // prompt below.
  app.get("/api/venues/:id/brand-kit", requireAuth, requireVenueOwner, requireFeature("venueBrandKit"), async (req, res) => {
    const kit = await prisma.venueBrandKit.findUnique({ where: { venueId: req.venue.id } });
    res.json(kit || { venueId: req.venue.id, logoUrl: null, primaryColor: null, toneOfVoice: null });
  });
  app.put("/api/venues/:id/brand-kit", requireAuth, requireVenueOwner, requireFeature("venueBrandKit"), async (req, res) => {
    const b = req.body || {};
    const data = {
      logoUrl: b.logoUrl ? String(b.logoUrl).trim() : null,
      primaryColor: b.primaryColor ? String(b.primaryColor).trim() : null,
      toneOfVoice: b.toneOfVoice ? String(b.toneOfVoice).trim() : null,
    };
    const kit = await prisma.venueBrandKit.upsert({
      where: { venueId: req.venue.id },
      create: { venueId: req.venue.id, ...data },
      update: data,
    });
    res.json(kit);
  });

  // ---- Venue social/email growth suite: real Meta connect+post, a real
  // guest-marketing subscriber list, and growth tools — the venue-dashboard
  // mirror of the organizer suite above (server/social-posting.js,
  // server/crypto-secrets.js, server/venue-marketing.js). Same "parked,
  // code-complete, inert until env vars are set" pattern: metaConfigured()/
  // encryptionConfigured() gate everything below the same way. ----

  const venueMetaOAuthState = new Map();
  function pruneVenueMetaOAuthState() {
    const now = Date.now();
    for (const [k, v] of venueMetaOAuthState) if (v.expires < now) venueMetaOAuthState.delete(k);
  }
  function venueIntegrationErrorResponse(err, res) {
    if (err instanceof IntegrationNotConfiguredError || err.code === "INTEGRATION_NOT_CONFIGURED") {
      return res.status(503).json({ error: { code: "INTEGRATION_NOT_CONFIGURED", message: err.message } });
    }
    return null;
  }

  app.get("/api/venues/:id/social-accounts", requireAuth, requireVenueOwner, async (req, res) => {
    const rows = await prisma.socialAccountConnection.findMany({ where: { venueId: req.venue.id } });
    res.json(rows.map(({ accessTokenEnc, ...rest }) => rest));
  });

  app.get("/api/venues/:id/social-accounts/meta/connect", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      pruneVenueMetaOAuthState();
      const state = crypto.randomBytes(16).toString("hex");
      venueMetaOAuthState.set(state, { venueId: req.venue.id, userId: req.user.id, expires: Date.now() + 10 * 60_000 });
      const url = buildMetaOAuthUrl(state);
      res.redirect(url);
    } catch (err) {
      const handled = venueIntegrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "GET /api/venues/:id/social-accounts/meta/connect", venueId: req.params.id }); res.status(500).json({ error: err.message }); }
    }
  });

  app.get("/api/venues/:id/social-accounts/meta/callback", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;
      if (oauthError) return res.status(400).json({ error: { code: "OAUTH_DENIED", message: String(oauthError) } });
      pruneVenueMetaOAuthState();
      const stateEntry = state && venueMetaOAuthState.get(String(state));
      if (!stateEntry || stateEntry.venueId !== req.venue.id || stateEntry.userId !== req.user.id) {
        return res.status(400).json({ error: { code: "INVALID_STATE", message: "OAuth state missing, expired, or mismatched — please try connecting again." } });
      }
      venueMetaOAuthState.delete(String(state));
      if (!code) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Missing code from Meta" } });

      const conn = await exchangeCodeForConnection(String(code));
      const saved = await prisma.socialAccountConnection.upsert({
        where: { venueId_provider: { venueId: req.venue.id, provider: "meta" } },
        create: { venueId: req.venue.id, provider: "meta", ...conn },
        update: conn,
      });
      await db.audit("venue.social_connect", { actorId: req.user.id, entityType: "socialAccountConnection", entityId: saved.id, metadata: { provider: "meta", venueId: req.venue.id } });
      res.redirect(`/venue-os/${req.venue.id}?tab=marketing&connected=meta`);
    } catch (err) {
      const handled = venueIntegrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "GET /api/venues/:id/social-accounts/meta/callback", venueId: req.params.id }); res.status(500).json({ error: err.message }); }
    }
  });

  app.delete("/api/venues/:id/social-accounts/meta/:connId", requireAuth, requireVenueOwner, async (req, res) => {
    const existing = await prisma.socialAccountConnection.findUnique({ where: { id: req.params.connId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
    await prisma.socialAccountConnection.delete({ where: { id: existing.id } });
    await db.audit("venue.social_disconnect", { actorId: req.user.id, entityType: "socialAccountConnection", entityId: existing.id, metadata: { provider: existing.provider, venueId: req.venue.id } });
    res.json({ ok: true });
  });

  // ---- Real posting: Instagram, via the venue's connected Meta account ----
  app.post("/api/venues/:id/marketing/post-to-instagram", socialLimiter, requireAuth, requireVenueOwner, requireFeature("venueSocialAutoPosting"), async (req, res) => {
    try {
      const v = req.venue;
      const connection = await prisma.socialAccountConnection.findUnique({ where: { venueId_provider: { venueId: v.id, provider: "meta" } } });
      if (!connection) return res.status(400).json({ error: { code: "NOT_CONNECTED", message: "Connect your Instagram/Facebook account first." } });
      const imageUrl = v.coverImage || v.photos?.[0];
      if (!imageUrl) return res.status(400).json({ error: { code: "NO_IMAGE", message: "This venue needs a cover photo before it can be posted." } });

      const b = req.body || {};
      const caption = String(b.caption || "").trim();
      if (!caption) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "caption is required" } });

      if (!b.confirmRepost) {
        const already = await prisma.venueSocialPost.findFirst({ where: { venueId: v.id, provider: "instagram", status: "posted" } });
        if (already) return res.status(409).json({ error: { code: "ALREADY_POSTED", message: "This venue was already posted to Instagram. Pass confirmRepost:true to post again anyway." }, previousPost: already });
      }

      let result;
      try {
        result = await publishInstagramPost(connection, { imageUrl, caption });
      } catch (err) {
        await prisma.venueSocialPost.create({ data: { venueId: v.id, provider: "instagram", copy: { caption, imageUrl }, status: "failed", error: err.message } });
        throw err;
      }
      const post = await prisma.venueSocialPost.create({
        data: { venueId: v.id, provider: "instagram", externalPostId: result.externalPostId, copy: { caption, imageUrl }, status: "posted" },
      });
      await db.audit("venue.social_post", { actorId: req.user.id, entityType: "venue", entityId: v.id, metadata: { provider: "instagram", postId: post.id } });
      res.status(201).json(post);
    } catch (err) {
      const handled = venueIntegrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "POST /api/venues/:id/marketing/post-to-instagram", venueId: req.params.id }); res.status(500).json({ error: err.message }); }
    }
  });

  app.get("/api/venues/:id/marketing/social-posts", requireAuth, requireVenueOwner, requireFeature("venueSocialAutoPosting"), async (req, res) => {
    res.json(await prisma.venueSocialPost.findMany({ where: { venueId: req.venue.id }, orderBy: { postedAt: "desc" } }));
  });

  // ---- Real email lists: venue-owned VenueMarketingContact subscriber list ----
  function newVenueUnsubscribeToken() {
    return crypto.randomBytes(24).toString("base64url");
  }

  app.get("/api/venues/:id/marketing-contacts", requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    res.json(await prisma.venueMarketingContact.findMany({ where: { venueId: req.venue.id }, orderBy: { createdAt: "desc" } }));
  });

  app.post("/api/venues/:id/marketing-contacts", requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name).trim() : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email is required" } });
    }
    try {
      const contact = await prisma.venueMarketingContact.upsert({
        where: { venueId_email: { venueId: req.venue.id, email } },
        create: { venueId: req.venue.id, email, name, source: "manual", unsubscribeToken: newVenueUnsubscribeToken() },
        update: { name: name ?? undefined, subscribed: true },
      });
      res.status(201).json(contact);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/marketing-contacts", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/venues/:id/marketing-contacts/import", requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    const raw = String(req.body?.csv || "");
    if (!raw.trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "csv text is required" } });
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const seen = new Map();
    for (const line of lines) {
      const [rawEmail, rawName] = line.split(",");
      const email = String(rawEmail || "").trim().toLowerCase();
      if (!email || email === "email" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      seen.set(email, rawName ? String(rawName).trim() : null);
    }
    let imported = 0;
    let skipped = 0;
    for (const [email, name] of seen) {
      try {
        await prisma.venueMarketingContact.upsert({
          where: { venueId_email: { venueId: req.venue.id, email } },
          create: { venueId: req.venue.id, email, name, source: "csv_import", unsubscribeToken: newVenueUnsubscribeToken() },
          update: { name: name ?? undefined },
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped, total: seen.size });
  });

  app.delete("/api/venues/:id/marketing-contacts/:contactId", requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    const existing = await prisma.venueMarketingContact.findUnique({ where: { id: req.params.contactId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } });
    await prisma.venueMarketingContact.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // Public, no-auth, one-click unsubscribe for the venue guest-marketing
  // list — a distinct token space from the organizer's MarketingContact
  // (separate model, separate @unique), so a separate public route rather
  // than reusing /api/marketing-contacts/unsubscribe/:token.
  app.get("/api/venue-marketing-contacts/unsubscribe/:token", async (req, res) => {
    const contact = await prisma.venueMarketingContact.findUnique({ where: { unsubscribeToken: req.params.token } });
    if (contact) await prisma.venueMarketingContact.update({ where: { id: contact.id }, data: { subscribed: false } });
    res.set("Content-Type", "text/html");
    res.send(`<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 24px;text-align:center"><h2>You're unsubscribed</h2><p style="color:#666">You won't receive marketing emails from this venue again.</p></body></html>`);
  });

  // ---- Real campaign send: existing AI-drafted venue campaign copy, sent
  // to the venue's subscribed VenueMarketingContact list via
  // server/email.js's sendEmail()/Resend wrapper. Same fixed-size-batch
  // approach as the organizer's send-email-campaign route. ----
  const VENUE_EMAIL_BATCH_SIZE = 25;
  app.post("/api/venues/:id/marketing/send-email-campaign", socialLimiter, requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const bodyText = String(req.body?.body || "").trim();
    if (!subject || !bodyText) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and body are required" } });

    const contacts = await prisma.venueMarketingContact.findMany({ where: { venueId: req.venue.id, subscribed: true } });
    const safeBody = bodyText.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let sent = 0;
    for (let i = 0; i < contacts.length; i += VENUE_EMAIL_BATCH_SIZE) {
      const batch = contacts.slice(i, i + VENUE_EMAIL_BATCH_SIZE);
      await Promise.all(batch.map((c) => {
        const unsubUrl = `${req.protocol}://${req.get("host")}/api/venue-marketing-contacts/unsubscribe/${c.unsubscribeToken}`;
        return sendEmail({
          to: c.email,
          subject: `${req.venue.name}: ${subject}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p style="white-space:pre-wrap;line-height:1.6;color:#222">${safeBody}</p><p style="color:#999;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">You're receiving this because you're on ${req.venue.name}'s mailing list. <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p></div>`,
        }).then(() => { sent++; }).catch((err) => captureError(err, { route: "POST /api/venues/:id/marketing/send-email-campaign", venueId: req.venue.id }));
      }));
    }

    const record = await prisma.venueEmailCampaignSend.create({
      data: { venueId: req.venue.id, subject, bodyHtml: safeBody, recipientCount: sent },
    });
    await db.audit("venue.email_campaign", { actorId: req.user.id, entityType: "venue", entityId: req.venue.id, metadata: { subject, recipients: contacts.length, sent } });
    res.status(201).json({ ok: true, recipients: contacts.length, sent, campaign: record });
  });

  app.get("/api/venues/:id/email-campaign-sends", requireAuth, requireVenueOwner, requireFeature("venueEmailCampaigns"), async (req, res) => {
    res.json(await prisma.venueEmailCampaignSend.findMany({ where: { venueId: req.venue.id }, orderBy: { sentAt: "desc" }, take: 100 }));
  });

  // ---- Venue growth tools ----
  app.get("/api/venues/:id/marketing/growth-ideas", importLimiter, requireAuth, requireVenueOwner, async (req, res) => {
    try {
      res.json({ ideas: await generateVenueGrowthIdeas(req.venue) });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/marketing/growth-ideas", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id/marketing/free-tool-ideas", importLimiter, requireAuth, requireVenueOwner, async (req, res) => {
    try {
      res.json({ ideas: await generateVenueFreeToolIdeas(req.venue) });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/marketing/free-tool-ideas", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id/marketing/angled-copy", importLimiter, requireAuth, requireVenueOwner, async (req, res) => {
    const angle = String(req.query.angle || "");
    if (!VENUE_PERSUASION_ANGLE_KEYS.includes(angle)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `angle must be one of: ${VENUE_PERSUASION_ANGLE_KEYS.join(", ")}` } });
    }
    try {
      const brandKit = await prisma.venueBrandKit.findUnique({ where: { venueId: req.venue.id } });
      res.json(await generateVenueAngledCopy(req.venue, brandKit, angle));
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/marketing/angled-copy", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id/marketing/bulk-ad-variants", importLimiter, requireAuth, requireVenueOwner, async (req, res) => {
    const platform = req.query.platform === "google" ? "google" : "meta";
    const count = Math.min(10, Math.max(1, parseInt(req.query.count, 10) || 3));
    try {
      const brandKit = await prisma.venueBrandKit.findUnique({ where: { venueId: req.venue.id } });
      const variants = await generateVenueBulkAdVariants(req.venue, brandKit, { platform, count });
      res.json({ platform, variants });
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/marketing/bulk-ad-variants", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Venue Workflows: the visual node-graph automation builder,
  // executed immediately at the trigger (server/venue-workflows.js), not
  // polled. Graph validation happens on every save (create + update), so a
  // malformed graph never gets persisted only to silently no-op later. ----
  app.get("/api/venues/:id/workflows", requireAuth, requireVenueOwner, async (req, res) => {
    res.json(await prisma.workflow.findMany({ where: { venueId: req.venue.id }, orderBy: { createdAt: "desc" } }));
  });

  app.post("/api/venues/:id/workflows", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const nodes = req.body?.nodes;
      const edges = req.body?.edges;
      if (!name) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      const invalid = validateWorkflowGraph(nodes, edges);
      if (invalid) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: invalid } });
      const workflow = await prisma.workflow.create({ data: { organizerId: req.user.id, venueId: req.venue.id, name, nodes, edges } });
      res.status(201).json(workflow);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/workflows", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/venues/:id/workflows/:workflowId", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const existing = await prisma.workflow.findUnique({ where: { id: req.params.workflowId } });
      if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const nodes = req.body?.nodes ?? existing.nodes;
      const edges = req.body?.edges ?? existing.edges;
      const invalid = validateWorkflowGraph(nodes, edges);
      if (invalid) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: invalid } });
      const updated = await prisma.workflow.update({ where: { id: existing.id }, data: { name, nodes, edges } });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id/workflows/:workflowId", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/venues/:id/workflows/:workflowId", requireAuth, requireVenueOwner, async (req, res) => {
    const existing = await prisma.workflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    const updated = await prisma.workflow.update({ where: { id: existing.id }, data: { enabled: !!req.body?.enabled } });
    res.json(updated);
  });

  app.delete("/api/venues/:id/workflows/:workflowId", requireAuth, requireVenueOwner, async (req, res) => {
    const existing = await prisma.workflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    await prisma.workflow.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // Execution log — the "debug mode" from the master automation-builder
  // prompt: which action nodes actually ran (and whether each succeeded)
  // for every time this workflow's trigger fired.
  app.get("/api/venues/:id/workflows/:workflowId/runs", requireAuth, requireVenueOwner, async (req, res) => {
    const existing = await prisma.workflow.findUnique({ where: { id: req.params.workflowId } });
    if (!existing || existing.venueId !== req.venue.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Workflow not found" } });
    const runs = await prisma.workflowRun.findMany({ where: { workflowId: existing.id }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json(runs);
  });

  // ============================================================
  // Floor plans: table/seat picking, shared by Venue reservations and
  // Event ticketing. See prisma/schema.prisma's FloorPlan comment for the
  // full model shape. `mode` is set once per venue/event by the owner —
  // "table" (assign whole tables) or "seat" (assign individual seats).
  // ============================================================

  const FLOOR_PLAN_INCLUDE = { sections: true, tables: { include: { seats: true }, orderBy: { createdAt: "asc" } } };

  // Owner-only: create (if missing) or fetch a venue's floor plan.
  app.post("/api/venues/:id/floor-plan", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const mode = req.body?.mode === "seat" ? "seat" : "table";
      const plan = await prisma.floorPlan.upsert({
        where: { venueId: req.venue.id },
        create: { venueId: req.venue.id, mode },
        update: {},
        include: FLOOR_PLAN_INCLUDE,
      });
      res.status(201).json(plan);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/floor-plan", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/venues/:id/floor-plan", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const plan = await prisma.floorPlan.findUnique({ where: { venueId: req.venue.id }, include: FLOOR_PLAN_INCLUDE });
      res.json(plan || null);
    } catch (err) {
      captureError(err, { route: "GET /api/venues/:id/floor-plan", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/venues/:id/floor-plan", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const mode = req.body?.mode === "seat" ? "seat" : "table";
      const plan = await prisma.floorPlan.update({ where: { venueId: req.venue.id }, data: { mode }, include: FLOOR_PLAN_INCLUDE });
      res.json(plan);
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id/floor-plan", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/venues/:id/floor-plan/sections", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      const plan = await prisma.floorPlan.findUnique({ where: { venueId: req.venue.id } });
      if (!plan) return res.status(400).json({ error: { code: "NO_FLOOR_PLAN", message: "Create the floor plan first" } });
      const section = await prisma.floorSection.create({ data: { floorPlanId: plan.id, name } });
      res.status(201).json(section);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/floor-plan/sections", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk-replace a venue's tables in one call — same "here is my current
  // layout" model as PUT /slots. Tables that carry an `id` are updated in
  // place (preserving assignment history); tables with no `id` are created;
  // any existing table NOT present in the incoming list is deleted (which
  // cascades to its seats and any assignment linking to it — acceptable for
  // a layout edit, since removing a table from the floor plan means it no
  // longer physically exists).
  app.put("/api/venues/:id/floor-plan/tables", requireAuth, requireVenueOwner, async (req, res) => {
    try {
      const plan = await prisma.floorPlan.findUnique({ where: { venueId: req.venue.id } });
      if (!plan) return res.status(400).json({ error: { code: "NO_FLOOR_PLAN", message: "Create the floor plan first" } });
      const incoming = Array.isArray(req.body?.tables) ? req.body.tables : [];
      const existing = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, select: { id: true } });
      const existingIds = new Set(existing.map((t) => t.id));
      const incomingIds = new Set(incoming.filter((t) => t.id).map((t) => t.id));
      const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

      const ops = [];
      if (toDelete.length) ops.push(prisma.floorTable.deleteMany({ where: { id: { in: toDelete } } }));
      for (const t of incoming) {
        const data = {
          label: String(t.label || "Table").slice(0, 40),
          shape: t.shape === "circle" ? "circle" : "rect",
          x: Number(t.x) || 0, y: Number(t.y) || 0,
          width: Number(t.width) || 80, height: Number(t.height) || 80,
          rotation: Number(t.rotation) || 0,
          minCapacity: Math.max(1, Number(t.minCapacity) || 1),
          maxCapacity: Math.max(1, Number(t.maxCapacity) || Number(t.minCapacity) || 2),
          sectionId: t.sectionId || null,
        };
        if (t.id && existingIds.has(t.id)) {
          ops.push(prisma.floorTable.update({ where: { id: t.id }, data }));
        } else {
          ops.push(prisma.floorTable.create({ data: { ...data, floorPlanId: plan.id } }));
        }
      }
      if (ops.length) await prisma.$transaction(ops);

      const tables = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, include: { seats: true }, orderBy: { createdAt: "asc" } });
      res.json({ tables });
    } catch (err) {
      captureError(err, { route: "PUT /api/venues/:id/floor-plan/tables", venueId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/floor-tables/:id/status", requireAuth, async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      if (!["available", "reserved", "occupied", "needs_cleaning", "maintenance"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid status" } });
      }
      const table = await prisma.floorTable.findUnique({ where: { id: req.params.id }, include: { floorPlan: { include: { venue: true, event: true } } } });
      if (!table) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Table not found" } });
      const ownerId = table.floorPlan.venue?.ownerId ?? table.floorPlan.event?.ownerId;
      if (ownerId !== req.user.id && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this table" } });
      }
      const updated = await prisma.floorTable.update({ where: { id: table.id }, data: { status } });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "PATCH /api/floor-tables/:id/status", tableId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Assign one-or-more tables to a reservation — the same shape covers
  // MERGE (many tableIds, one assignment) and re-assignment (replace the
  // existing assignment's tables). A table already assigned to a different
  // *active* reservation at an overlapping date is rejected with 409 rather
  // than silently double-booking it.
  app.post("/api/reservations/:id/assign-tables", requireAuth, async (req, res) => {
    try {
      const tableIds = Array.isArray(req.body?.tableIds) ? req.body.tableIds.filter(Boolean) : [];
      if (!tableIds.length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "tableIds is required" } });

      const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { venue: true } });
      if (!reservation) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Reservation not found" } });
      if (reservation.venue.ownerId !== req.user.id && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this venue" } });
      }

      const tables = await prisma.floorTable.findMany({ where: { id: { in: tableIds } }, include: { floorPlan: true } });
      if (tables.length !== tableIds.length || tables.some((t) => t.floorPlan.venueId !== reservation.venueId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid table(s) for this venue" } });
      }

      const dayStart = new Date(reservation.date); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
      const conflict = await prisma.tableAssignmentTable.findFirst({
        where: {
          tableId: { in: tableIds },
          assignment: {
            reservationId: { not: reservation.id },
            date: { gte: dayStart, lt: dayEnd },
            reservation: { status: { in: ["pending", "confirmed", "seated"] } },
          },
        },
      });
      if (conflict) return res.status(409).json({ error: { code: "TABLE_CONFLICT", message: "One of these tables is already assigned for this date" } });

      const saved = await prisma.tableAssignment.upsert({
        where: { reservationId: reservation.id },
        create: {
          reservationId: reservation.id, date: reservation.date, time: reservation.time, partySize: reservation.partySize,
          tables: { create: tableIds.map((tableId) => ({ tableId })) },
        },
        update: {
          date: reservation.date, time: reservation.time, partySize: reservation.partySize,
          tables: { deleteMany: {}, create: tableIds.map((tableId) => ({ tableId })) },
        },
        include: { tables: { include: { table: true } } },
      });
      res.json(saved);
    } catch (err) {
      captureError(err, { route: "POST /api/reservations/:id/assign-tables", reservationId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/reservations/:id/assign-tables", requireAuth, async (req, res) => {
    try {
      const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { venue: true } });
      if (!reservation) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Reservation not found" } });
      if (reservation.venue.ownerId !== req.user.id && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this venue" } });
      }
      await prisma.tableAssignment.deleteMany({ where: { reservationId: reservation.id } });
      res.json({ ok: true });
    } catch (err) {
      captureError(err, { route: "DELETE /api/reservations/:id/assign-tables", reservationId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- event floor plans (organizer-side) — same shape as venue floor
  // plans above, gated by requireEventAccess("MANAGER") instead of venue
  // ownership. Used for assigned-seating ticketed events. ----
  app.post("/api/events/:id/floor-plan", requireEventAccess("MANAGER"), async (req, res) => {
    try {
      const mode = req.body?.mode === "seat" ? "seat" : "table";
      const plan = await prisma.floorPlan.upsert({
        where: { eventId: req.event.id },
        create: { eventId: req.event.id, mode },
        update: {},
        include: FLOOR_PLAN_INCLUDE,
      });
      res.status(201).json(plan);
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/floor-plan", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/events/:id/floor-plan", requireEventAccess("MANAGER"), async (req, res) => {
    try {
      const plan = await prisma.floorPlan.findUnique({ where: { eventId: req.event.id }, include: FLOOR_PLAN_INCLUDE });
      res.json(plan || null);
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/floor-plan", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/events/:id/floor-plan", requireEventAccess("MANAGER"), async (req, res) => {
    try {
      const mode = req.body?.mode === "seat" ? "seat" : "table";
      const plan = await prisma.floorPlan.update({ where: { eventId: req.event.id }, data: { mode }, include: FLOOR_PLAN_INCLUDE });
      res.json(plan);
    } catch (err) {
      captureError(err, { route: "PUT /api/events/:id/floor-plan", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk-replace an event's tables — mirrors PUT /api/venues/:id/floor-plan/tables.
  // For "seat" mode, each table's `seatCount` (not persisted on the table
  // itself) drives how many FloorSeat rows get created/trimmed under it —
  // seats are numbered 1..seatCount and any existing seat past the new
  // count is deleted (cascading to release its ticket's seatId, handled by
  // the FK's ON DELETE SET NULL... actually seats cascade-delete from their
  // table, and Ticket.seatId is ON DELETE SET NULL, so a shrink never
  // orphans a ticket — it just loses its specific seat label).
  app.put("/api/events/:id/floor-plan/tables", requireEventAccess("MANAGER"), async (req, res) => {
    try {
      const plan = await prisma.floorPlan.findUnique({ where: { eventId: req.event.id } });
      if (!plan) return res.status(400).json({ error: { code: "NO_FLOOR_PLAN", message: "Create the floor plan first" } });
      const incoming = Array.isArray(req.body?.tables) ? req.body.tables : [];
      const existing = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, select: { id: true } });
      const existingIds = new Set(existing.map((t) => t.id));
      const incomingIds = new Set(incoming.filter((t) => t.id).map((t) => t.id));
      const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

      if (toDelete.length) await prisma.floorTable.deleteMany({ where: { id: { in: toDelete } } });
      for (const t of incoming) {
        const data = {
          label: String(t.label || "Table").slice(0, 40),
          shape: t.shape === "circle" ? "circle" : "rect",
          x: Number(t.x) || 0, y: Number(t.y) || 0,
          width: Number(t.width) || 80, height: Number(t.height) || 80,
          rotation: Number(t.rotation) || 0,
          minCapacity: Math.max(1, Number(t.minCapacity) || 1),
          maxCapacity: Math.max(1, Number(t.maxCapacity) || Number(t.minCapacity) || 2),
          sectionId: t.sectionId || null,
        };
        let table;
        if (t.id && existingIds.has(t.id)) {
          table = await prisma.floorTable.update({ where: { id: t.id }, data });
        } else {
          table = await prisma.floorTable.create({ data: { ...data, floorPlanId: plan.id } });
        }
        if (plan.mode === "seat") {
          const seatCount = Math.max(0, Number(t.seatCount) || data.maxCapacity);
          const currentSeats = await prisma.floorSeat.findMany({ where: { tableId: table.id }, orderBy: { index: "asc" } });
          if (currentSeats.length > seatCount) {
            await prisma.floorSeat.deleteMany({ where: { id: { in: currentSeats.slice(seatCount).map((s) => s.id) } } });
          } else if (currentSeats.length < seatCount) {
            await prisma.floorSeat.createMany({
              data: Array.from({ length: seatCount - currentSeats.length }, (_, i) => ({ tableId: table.id, index: currentSeats.length + i + 1 })),
            });
          }
        }
      }

      const tables = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, include: { seats: true }, orderBy: { createdAt: "asc" } });
      res.json({ tables });
    } catch (err) {
      captureError(err, { route: "PUT /api/events/:id/floor-plan/tables", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Public seat map — read-only, no owner-sensitive data, used to render
  // the guest-facing seat picker before checkout on a "seat" mode event.
  app.get("/api/events/:id/seatmap", async (req, res) => {
    try {
      const plan = await prisma.floorPlan.findUnique({ where: { eventId: req.params.id }, include: FLOOR_PLAN_INCLUDE });
      if (!plan) return res.status(404).json({ error: { code: "NOT_FOUND", message: "This event has no seating map" } });
      res.json(plan);
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/seatmap", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- admin: venue-application review queue ----
  // The private surface where the Weyn team verifies ownership proof and
  // approves/rejects. Approving mints a live, verified Venue owned by the
  // applicant; rejecting records a reason. ADMIN-only, like every /api/admin.
  app.get("/api/admin/venue-applications", requireAuth, requireRole("ADMIN"), async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const where = status && status !== "all" ? { status } : {};
      const applications = await prisma.venueApplication.findMany({ where, orderBy: { createdAt: "desc" } });
      res.json(applications);
    } catch (err) {
      captureError(err, { route: "GET /api/admin/venue-applications" });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/venue-applications/:id/approve", requireAuth, requireRole("ADMIN"), async (req, res) => {
    try {
      const app_ = await prisma.venueApplication.findUnique({ where: { id: req.params.id } });
      if (!app_) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
      if (app_.status === "approved" && app_.resultingVenueId) {
        return res.status(409).json({ error: { code: "ALREADY_APPROVED", message: "This application is already approved", venueId: app_.resultingVenueId } });
      }
      // Atomic: previously venue.create and venueApplication.update were
      // separate calls, so a failure between them left an orphaned live
      // Venue while the application still showed "pending" — and retrying
      // the approve would mint a SECOND Venue (the ALREADY_APPROVED guard
      // above only trips once resultingVenueId is successfully written).
      // A transaction makes the whole approval succeed or fail as one unit.
      const { venue, updated } = await prisma.$transaction(async (tx) => {
        const venue = await tx.venue.create({
          data: {
            name: app_.name,
            category: app_.businessType,
            description: app_.description || "",
            venue: app_.venue || app_.area || "Muscat",
            area: app_.area || "Muscat",
            lat: app_.lat ?? 23.6100,
            lng: app_.lng ?? 58.5400,
            distanceKm: +(Math.random() * 8 + 1).toFixed(1),
            coverImage: app_.coverImage,
            photos: app_.photos,
            priceRange: app_.priceRange,
            tags: app_.guestTags,
            ownerId: app_.applicantId,
            verified: true,
            subscriptionTier: app_.subscriptionTier,
            subscriptionStatus: "active",
          },
        });
        // Carry the Step-6 availability the applicant already entered
        // straight into real bookable slots — previously this data was
        // collected and silently discarded, so an approved owner opened
        // their brand-new dashboard to find zero slots and had to redo
        // work they'd already done once.
        if (Array.isArray(app_.availability) && app_.availability.length) {
          await tx.venueAvailabilitySlot.createMany({
            data: app_.availability.map((s) => ({
              venueId: venue.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity,
            })),
          });
        }
        const updated = await tx.venueApplication.update({
          where: { id: app_.id },
          data: { status: "approved", reviewedBy: req.user.id, reviewedAt: new Date(), resultingVenueId: venue.id, reviewNote: req.body?.note ? String(req.body.note) : null },
        });
        return { venue, updated };
      });
      // Let the applicant know they're live — both email and push,
      // best-effort and independent (one failing never blocks the other,
      // and neither blocks the response since approval already succeeded).
      if (app_.contactEmail) {
        sendEmail({
          to: app_.contactEmail,
          subject: `${app_.name} is now live on Weyn`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">You're approved 🎉</h2><p style="color:#444;line-height:1.5"><b>${app_.name}</b> is now listed on Weyn for reservations. Sign in and open your venue dashboard to set your availability and manage bookings.</p><p style="margin:22px 0"><a href="${(process.env.PUBLIC_APP_URL || "https://weynevents.com").replace(/\/$/, "")}/you" style="background:#1C6DD0;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open my dashboard</a></p></div>`,
        }).catch((err) => captureError(err, { route: "approve venue-application (email)", applicationId: app_.id }));
      }
      if (app_.applicantId) {
        notifyUser(app_.applicantId, {
          title: "You're approved 🎉",
          body: `${app_.name} is now live on Weyn for reservations.`,
          data: { type: "venue_approved", venueId: venue.id },
          url: "/you",
        }).catch((err) => captureError(err, { route: "approve venue-application (push)", applicationId: app_.id }));
      }
      trackEvent(req.user.id, "venue_application_approved", { applicationId: app_.id, venueId: venue.id });
      res.json({ application: updated, venue });
    } catch (err) {
      captureError(err, { route: "POST /api/admin/venue-applications/:id/approve", applicationId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/venue-applications/:id/reject", requireAuth, requireRole("ADMIN"), async (req, res) => {
    try {
      const app_ = await prisma.venueApplication.findUnique({ where: { id: req.params.id } });
      if (!app_) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
      const note = req.body?.note ? String(req.body.note) : null;
      const updated = await prisma.venueApplication.update({
        where: { id: app_.id },
        data: { status: "rejected", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: note },
      });
      // Previously silent — approval emailed the applicant but rejection
      // didn't, so a rejected applicant just never heard back at all with
      // no way to tell "still pending" from "rejected".
      if (app_.contactEmail) {
        sendEmail({
          to: app_.contactEmail,
          subject: `Update on your Weyn application: ${app_.name}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">About your application</h2><p style="color:#444;line-height:1.5">We've reviewed <b>${app_.name}</b> and aren't able to list it on Weyn at this time.${note ? ` <br/><br/>${note.replace(/</g, "&lt;")}` : ""}</p><p style="color:#444;line-height:1.5">If you think this was a mistake or have questions, reply to this email and we'll take another look.</p></div>`,
        }).catch((err) => captureError(err, { route: "reject venue-application (email)", applicationId: app_.id }));
      }
      trackEvent(req.user.id, "venue_application_rejected", { applicationId: app_.id });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "POST /api/admin/venue-applications/:id/reject", applicationId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // ---- organizer dashboard ----
  app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
    res.json(await db.dashboardSummary(req.user.id));
  });

  app.get("/api/dashboard/activity", requireAuth, async (req, res) => {
    res.json(await db.recentActivity(req.user.id));
  });

  // events the signed-in user owns OR has accepted team access to —
  // distinct from GET /api/events (the public listing)
  app.get("/api/dashboard/events", requireAuth, async (req, res) => {
    res.json(await db.eventsAccessibleTo(req.user.id));
  });

  // ---- organizer dashboard rebuild: cross-event views ----
  app.get("/api/organizer/overview", requireAuth, async (req, res) => {
    res.json(await db.organizerOverview(req.user.id));
  });
  app.get("/api/organizer/attendees", requireAuth, async (req, res) => {
    res.json(await db.organizerAttendees(req.user.id));
  });
  // Same CSV-injection guard as the per-event export above — this data
  // includes attendee-supplied names/emails, still untrusted free text.
  app.get("/api/organizer/attendees.csv", requireAuth, requireFeature("csvExports"), async (req, res) => {
    const rows = await db.organizerAttendees(req.user.id);
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ["Name,Email,Total Spend,Tickets Bought,Events Attended,Last Booked,Tags,Loyalty Points,Notes"];
    for (const a of rows) {
      lines.push([
        escape(a.name), escape(a.email), escape(a.totalSpend), escape(a.ticketsBought), escape(a.eventsAttended),
        escape(a.lastBookedAt), escape(a.tags.join("; ")), escape(a.loyaltyPoints), escape(a.notes),
      ].join(","));
    }
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="weyn-attendees-${req.user.id}.csv"`);
    res.send(lines.join("\n"));
  });
  app.patch("/api/organizer/attendees/profile", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.email || !String(b.email).trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Missing email" } });
    const patch = {};
    if (Array.isArray(b.tags)) patch.tags = b.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
    if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 2000);
    if (b.loyaltyPoints !== undefined) patch.loyaltyPoints = Math.max(0, Number(b.loyaltyPoints) || 0);
    const updated = await db.upsertAttendeeProfile(req.user.id, String(b.email).trim(), patch);
    res.json(updated);
  });
  app.get("/api/organizer/finance", requireAuth, async (req, res) => {
    res.json(await db.organizerFinance(req.user.id));
  });
  app.get("/api/organizer/expenses", requireAuth, async (req, res) => {
    res.json(await db.listExpenses(req.user.id, req.query.eventId || undefined));
  });
  app.post("/api/organizer/expenses", requireAuth, async (req, res) => {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!b.category || !String(b.category).trim() || !(amount > 0)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A category and a positive amount are required." } });
    }
    const expense = await db.createExpense({
      organizerId: req.user.id, eventId: b.eventId || null, category: String(b.category).trim().slice(0, 60),
      amount, note: b.note ? String(b.note).trim().slice(0, 500) : null, date: b.date ? new Date(b.date) : undefined,
    });
    res.status(201).json(expense);
  });
  app.delete("/api/organizer/expenses/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteExpense(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Expense not found" } });
    res.json({ ok: true });
  });

  // ---- Budget tracking with alerts — Budget rows are per-event/category
  // allocations; "actual" is summed from Expense by matching category
  // string (loose, not a hard FK — see schema.prisma's Budget comment) ----
  app.get("/api/events/:id/budgets", requireEventAccess("MANAGER"), async (req, res) => {
    const [budgets, expenses] = await Promise.all([
      prisma.budget.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "asc" } }),
      prisma.expense.findMany({ where: { eventId: req.event.id }, select: { category: true, amount: true } }),
    ]);
    const spentByCategory = new Map();
    for (const e of expenses) spentByCategory.set(e.category, (spentByCategory.get(e.category) || 0) + e.amount);
    res.json(budgets.map((b) => {
      const spent = +(spentByCategory.get(b.category) || 0).toFixed(2);
      return { ...b, spent, remaining: +(b.allocatedAmount - spent).toFixed(2), overBudget: spent > b.allocatedAmount };
    }));
  });
  app.post("/api/events/:id/budgets", requireEventAccess("MANAGER"), async (req, res) => {
    const b = req.body || {};
    const allocatedAmount = Number(b.allocatedAmount);
    if (!b.category || !String(b.category).trim() || !(allocatedAmount > 0)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A category and a positive allocatedAmount are required." } });
    }
    try {
      const budget = await prisma.budget.create({
        data: { eventId: req.event.id, category: String(b.category).trim().slice(0, 60), allocatedAmount, currency: b.currency ? String(b.currency).slice(0, 8) : "OMR" },
      });
      res.status(201).json(budget);
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "A budget for that category already exists on this event" } });
      throw err;
    }
  });
  app.patch("/api/events/:id/budgets/:budgetId", requireEventAccess("MANAGER"), async (req, res) => {
    const existing = await prisma.budget.findUnique({ where: { id: req.params.budgetId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Budget not found" } });
    const patch = {};
    if (req.body?.allocatedAmount != null) patch.allocatedAmount = Math.max(0, Number(req.body.allocatedAmount) || 0);
    const updated = await prisma.budget.update({ where: { id: existing.id }, data: patch });
    res.json(updated);
  });
  app.delete("/api/events/:id/budgets/:budgetId", requireEventAccess("MANAGER"), async (req, res) => {
    const existing = await prisma.budget.findUnique({ where: { id: req.params.budgetId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Budget not found" } });
    await prisma.budget.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });
  app.get("/api/organizer/finance/export.csv", requireAuth, requireFeature("csvExports"), async (req, res) => {
    const [finance, expenses] = await Promise.all([db.organizerFinance(req.user.id), db.listExpenses(req.user.id)]);
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ["Section,Event/Category,Tickets,Amount (OMR),Date"];
    for (const e of finance.byEvent) lines.push(["Revenue", escape(e.title), e.ticketsSold, e.revenue, ""].join(","));
    for (const ex of expenses) lines.push(["Expense", escape(ex.event ? `${ex.category} (${ex.event.title})` : ex.category), "", -ex.amount, escape(ex.date.toISOString().slice(0, 10))].join(","));
    lines.push(["", "", "", "", ""].join(","));
    lines.push(["Summary", "Total revenue", "", finance.totalRevenue, ""].join(","));
    lines.push(["Summary", "Platform fees", "", -finance.feesPaid, ""].join(","));
    lines.push(["Summary", "Total expenses", "", -finance.totalExpenses, ""].join(","));
    lines.push(["Summary", "Net profit", "", finance.netProfit, ""].join(","));
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="finance-${req.user.id}.csv"`);
    res.send(lines.join("\n"));
  });

  // ---- File Library (URL references) ----
  app.get("/api/organizer/files", requireAuth, async (req, res) => {
    res.json(await db.listMediaAssets(req.user.id, req.query.eventId || undefined));
  });
  app.post("/api/organizer/files", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.url || !String(b.url).trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A URL is required." } });
    const asset = await db.createMediaAsset({
      organizerId: req.user.id, eventId: b.eventId || null, url: String(b.url).trim().slice(0, 1000),
      type: ["image", "video", "document"].includes(b.type) ? b.type : "document",
      folder: b.folder ? String(b.folder).trim().slice(0, 60) : null,
      tags: Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10) : [],
    });
    res.status(201).json(asset);
  });
  app.delete("/api/organizer/files/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteMediaAsset(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "File not found" } });
    res.json({ ok: true });
  });

  // ---- Sponsor management ----
  app.get("/api/organizer/sponsors", requireAuth, async (req, res) => {
    res.json(await db.listSponsors(req.user.id, req.query.eventId || undefined));
  });
  app.post("/api/organizer/sponsors", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A sponsor name is required." } });
    const sponsor = await db.createSponsor({
      organizerId: req.user.id, eventId: b.eventId || null, name: String(b.name).trim().slice(0, 100),
      contactEmail: b.contactEmail || null, contactPhone: b.contactPhone || null, contractUrl: b.contractUrl || null,
      logoUrl: b.logoUrl || null, amount: b.amount != null ? Number(b.amount) : null,
      deliverables: Array.isArray(b.deliverables) ? b.deliverables.map((d) => String(d).trim()).filter(Boolean).slice(0, 20) : [],
    });
    res.status(201).json(sponsor);
  });
  app.patch("/api/organizer/sponsors/:id", requireAuth, async (req, res) => {
    const patch = {};
    if (req.body?.status && ["prospect", "confirmed", "delivered"].includes(req.body.status)) patch.status = req.body.status;
    // ---- Sponsor ROI tracking ----
    for (const key of ["impressions", "clicks", "leadsGenerated"]) {
      if (req.body?.[key] != null) patch[key] = Math.max(0, Math.round(Number(req.body[key])) || 0);
    }
    const updated = await db.updateSponsor(req.params.id, req.user.id, patch);
    if (!updated) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Sponsor not found" } });
    res.json(updated);
  });
  app.delete("/api/organizer/sponsors/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteSponsor(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Sponsor not found" } });
    res.json({ ok: true });
  });

  // ---- Vendor management ----
  app.get("/api/organizer/vendors", requireAuth, async (req, res) => {
    res.json(await db.listVendors(req.user.id, req.query.eventId || undefined));
  });
  app.post("/api/organizer/vendors", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim() || !b.category) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A vendor name and category are required." } });
    const vendor = await db.createVendor({
      organizerId: req.user.id, eventId: b.eventId || null, category: String(b.category).trim().slice(0, 40), name: String(b.name).trim().slice(0, 100),
      contactEmail: b.contactEmail || null, contactPhone: b.contactPhone || null, contractUrl: b.contractUrl || null,
      paymentStatus: b.paymentStatus || "pending", notes: b.notes || null,
    });
    res.status(201).json(vendor);
  });
  app.patch("/api/organizer/vendors/:id", requireAuth, async (req, res) => {
    const patch = {};
    if (req.body?.paymentStatus) patch.paymentStatus = String(req.body.paymentStatus).slice(0, 20);
    if (req.body?.rating != null) patch.rating = Math.max(1, Math.min(5, Number(req.body.rating)));
    const updated = await db.updateVendor(req.params.id, req.user.id, patch);
    if (!updated) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Vendor not found" } });
    res.json(updated);
  });
  app.delete("/api/organizer/vendors/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteVendor(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Vendor not found" } });
    res.json({ ok: true });
  });

  // ---- Message templates ----
  app.get("/api/organizer/message-templates", requireAuth, async (req, res) => {
    res.json(await db.listMessageTemplates(req.user.id));
  });
  app.post("/api/organizer/message-templates", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim() || !b.message || !String(b.message).trim()) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A name and message are required." } });
    }
    const template = await db.createMessageTemplate({
      organizerId: req.user.id, name: String(b.name).trim().slice(0, 80),
      subject: b.subject ? String(b.subject).trim().slice(0, 200) : null,
      message: String(b.message).trim().slice(0, 2000),
    });
    res.status(201).json(template);
  });
  app.delete("/api/organizer/message-templates/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteMessageTemplate(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Template not found" } });
    res.json({ ok: true });
  });

  app.get("/api/me/organizer-settings", requireAuth, async (req, res) => {
    res.json({ settings: await db.getOrganizerSettings(req.user.id) });
  });
  app.put("/api/me/organizer-settings", requireAuth, async (req, res) => {
    const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {};
    res.json({ settings: await db.setOrganizerSettings(req.user.id, settings) });
  });

  app.get("/api/events/:id/analytics", requireEventAccess("MANAGER"), async (req, res) => {
    // Gated on the EVENT OWNER's plan, not the viewer's — a team member
    // with MANAGER access should see the same advanced stats the owner
    // would, not a downgraded view based on their own personal account.
    const advanced = !!(req.event.ownerId && (await hasFeature(req.event.ownerId, "advancedAnalytics")));
    res.json(await db.eventAnalytics(req.event.id, { advanced }));
  });
  app.get("/api/events/:id/promotion", requireEventAccess("MANAGER"), async (req, res) => {
    res.json(await db.promotionSources(req.event.id));
  });
  app.get("/api/events/:id/audit-log", requireEventAccess("MANAGER"), async (req, res) => {
    res.json(await db.eventAuditLog(req.event.id));
  });

  // ---- QR flyer/poster generator — a downloadable SVG combining the
  // event's title/date/venue with a QR code linking to the public event
  // page, for print or social sharing. SVG (not a raster image) since
  // there's no canvas/image-rendering lib in this server's dependencies —
  // an SVG renders and prints fine, and stays crisp at any size. ----
  app.get("/api/events/:id/flyer.svg", requireEventAccess("MANAGER"), async (req, res) => {
    const e = req.event;
    const eventUrl = `${publicOrigin(req)}/e/${e.id}`;
    const qrSvg = await QRCode.toString(eventUrl, { type: "svg", margin: 1, width: 340, color: { dark: "#1c1b1a", light: "#ffffff" } });
    const dateStr = new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
    const bg = /^#[0-9a-fA-F]{6}$/.test(e.color || "") ? e.color : "#1c1b1a";
    const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
  <rect width="800" height="1200" fill="${bg}"/>
  <rect x="40" y="40" width="720" height="1120" rx="24" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.15"/>
  <text x="80" y="140" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${escapeHtml(e.title).slice(0, 40)}</text>
  <text x="80" y="200" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff">${escapeHtml(dateStr)}</text>
  <text x="80" y="240" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#ffffff" fill-opacity="0.8">${escapeHtml(e.venue)}, ${escapeHtml(e.area)}</text>
  <g transform="translate(230, 700)">${qrSvg}</g>
  <text x="400" y="1080" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.7" text-anchor="middle">Scan to view &amp; book · weynevents.com</text>
</svg>`;
    res.set("Content-Type", "image/svg+xml");
    res.set("Content-Disposition", `attachment; filename="${e.id}-flyer.svg"`);
    res.send(poster);
  });

  // ---- Feedback Center — public submission (any past attendee, no auth),
  // organizer-side viewing is owner/manager only ----
  app.post("/api/events/:id/feedback", socialLimiter, async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const b = req.body || {};
    const rating = b.rating != null ? Math.max(1, Math.min(5, Math.round(Number(b.rating)))) : null;
    const npsScore = b.npsScore != null ? Math.max(0, Math.min(10, Math.round(Number(b.npsScore)))) : null;
    if (rating === null && npsScore === null && !b.comment) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Give a rating or a comment." } });
    }
    const feedback = await db.submitFeedback({ eventId: e.id, bookingId: b.bookingId || null, rating, npsScore, comment: b.comment ? String(b.comment).trim().slice(0, 1000) : null });
    res.status(201).json({ id: feedback.id, ok: true });
  });
  app.get("/api/events/:id/feedback", requireEventAccess("MANAGER"), async (req, res) => {
    res.json(await db.listFeedback(req.event.id));
  });

  // Standard NPS: %promoters (9-10) minus %detractors (0-6), ignoring
  // passives (7-8) in the denominator's numerator but not its total —
  // the textbook formula, not a custom weighting.
  app.get("/api/events/:id/feedback/nps", requireEventAccess("MANAGER"), async (req, res) => {
    const rows = await prisma.eventFeedback.findMany({ where: { eventId: req.event.id, npsScore: { not: null } }, select: { npsScore: true } });
    const total = rows.length;
    if (!total) return res.json({ total: 0, nps: null, promoters: 0, passives: 0, detractors: 0 });
    const promoters = rows.filter((r) => r.npsScore >= 9).length;
    const detractors = rows.filter((r) => r.npsScore <= 6).length;
    const passives = total - promoters - detractors;
    const nps = Math.round(((promoters - detractors) / total) * 100);
    res.json({ total, nps, promoters, passives, detractors });
  });

  // AI summary of free-text feedback comments into themes — reuses the same
  // askClaude (Gemini/Groq-backed) call pattern as the rest of AI Studio.
  // Best-effort: 503s cleanly if no LLM key is configured rather than
  // pretending to summarize.
  app.post("/api/events/:id/feedback/summarize", requireEventAccess("MANAGER"), async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "AI isn't configured on this server yet." } });
    const rows = await prisma.eventFeedback.findMany({ where: { eventId: req.event.id, comment: { not: null } }, select: { comment: true, rating: true, npsScore: true }, take: 300 });
    const comments = rows.map((r) => r.comment).filter(Boolean);
    if (!comments.length) return res.json({ summary: "No written feedback comments yet.", themes: [] });
    const prompt = `You are analyzing post-event attendee feedback for an events platform. Summarize the following comments into 3-6 short themes (a few words each), then a 2-3 sentence overall summary. Respond as strict JSON: {"themes": ["..."], "summary": "..."}.\n\nComments:\n${comments.slice(0, 200).map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
    try {
      const result = await askClaudeJson(prompt, { maxTokens: 500 });
      res.json({ summary: result?.summary || "", themes: Array.isArray(result?.themes) ? result.themes : [] });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/feedback/summarize", eventId: req.event.id });
      res.status(502).json({ error: { code: "AI_ERROR", message: "Couldn't summarize feedback right now." } });
    }
  });

  // ---- Organizer Goals ----
  app.get("/api/organizer/goals/:month", requireAuth, async (req, res) => {
    res.json(await db.goalProgress(req.user.id, req.params.month));
  });
  app.put("/api/organizer/goals/:month", requireAuth, async (req, res) => {
    const b = req.body || {};
    const patch = {};
    for (const key of ["revenueGoal", "attendanceGoal", "eventsGoal", "followersGoal"]) {
      if (b[key] != null && b[key] !== "") patch[key] = key === "revenueGoal" ? Number(b[key]) : parseInt(b[key], 10);
    }
    const goal = await db.setGoal(req.user.id, req.params.month, patch);
    res.json(goal);
  });

  // ---- Automation Builder (see schema.prisma's AutomationRule comment —
  // only "capacity_threshold" actually fires, see runAutomationScan) ----
  app.get("/api/organizer/automations", requireAuth, async (req, res) => {
    res.json(await db.listAutomationRules(req.user.id, req.query.eventId || undefined));
  });
  app.post("/api/organizer/automations", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.trigger || !b.action) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Name, trigger, and action are required." } });
    const rule = await db.createAutomationRule({
      organizerId: req.user.id, eventId: b.eventId || null, name: String(b.name).trim().slice(0, 80),
      trigger: b.trigger, action: b.action, config: b.config || {},
    });
    res.status(201).json(rule);
  });
  app.patch("/api/organizer/automations/:id", requireAuth, async (req, res) => {
    const updated = await db.setAutomationRuleEnabled(req.params.id, req.user.id, !!req.body?.enabled);
    if (!updated) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation rule not found" } });
    res.json(updated);
  });
  app.delete("/api/organizer/automations/:id", requireAuth, async (req, res) => {
    const ok = await db.deleteAutomationRule(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Automation rule not found" } });
    res.json({ ok: true });
  });

  // ---- team management (see schema.prisma's EventTeamMember comment) ----
  // Invite/revoke are owner-only (requireEventOwnerStrict) — a MANAGER runs
  // the event day-to-day but can't grant or remove other people's access.
  // STAFF is check-in-only by default; these extra tags don't unlock new
  // routes on their own yet (every route below still checks the coarse
  // STAFF/MANAGER rank), but they're stored and surfaced in the Team tab so
  // an organizer can note "this staffer can also see attendees" — the finer
  // gate on each route is follow-up work, not a promise this already exists.
  const TEAM_PERMISSIONS = ["viewAttendees", "viewFinance", "sendNotifications"];
  app.post("/api/events/:id/team/invite", teamInviteLimiter, requireEventOwnerStrict(), async (req, res) => {
    const { email, role } = req.body || {};
    if (!email || !["MANAGER", "STAFF"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "email and role (MANAGER or STAFF) are required" } });
    }
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((p) => TEAM_PERMISSIONS.includes(p)) : [];
    const invite = await db.createTeamInvite({ eventId: req.event.id, invitedEmail: email, role, invitedBy: req.user.id, permissions });
    await db.audit("event.team.invite", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { email, role, permissions } });
    const origin = publicOrigin(req);
    const inviteLink = `${origin}/invite/${invite.inviteToken}`;
    if (emailConfigured()) {
      sendEmail({ to: email, ...teamInviteEmail({ eventTitle: req.event.title, role, inviteLink }) })
        .catch((err) => console.error("team invite email failed:", err.message));
    }
    res.status(201).json({ id: invite.id, email: invite.invitedEmail, role: invite.role, inviteLink });
  });

  app.get("/api/events/:id/team", requireEventOwner(), async (req, res) => {
    const members = await db.listTeamMembers(req.event.id);
    res.json(members.map((m) => ({
      id: m.id, email: m.invitedEmail, role: m.role, status: m.status, permissions: m.permissions || [],
      user: m.user ? { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl } : null,
      createdAt: m.createdAt, acceptedAt: m.acceptedAt,
    })));
  });

  app.delete("/api/events/:id/team/:memberId", requireEventOwnerStrict(), async (req, res) => {
    const member = await db.getTeamMemberById(req.params.memberId);
    if (!member || member.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Team member not found" } });
    await db.revokeTeamMember(member.id);
    await db.audit("event.team.revoke", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { memberId: member.id } });
    res.json({ ok: true });
  });

  // ---- Staff shift scheduling ----
  app.get("/api/events/:id/shifts", requireEventAccess("MANAGER"), async (req, res) => {
    const shifts = await prisma.eventShift.findMany({
      where: { eventId: req.event.id },
      include: { teamMember: { select: { id: true, invitedEmail: true, role: true } } },
      orderBy: { startTime: "asc" },
    });
    res.json(shifts);
  });
  app.post("/api/events/:id/shifts", requireEventAccess("MANAGER"), async (req, res) => {
    const b = req.body || {};
    if (!b.teamMemberId || !b.startTime || !b.endTime) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "teamMemberId, startTime and endTime are required." } });
    }
    const member = await db.getTeamMemberById(b.teamMemberId);
    if (!member || member.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Team member not found" } });
    const startTime = new Date(b.startTime);
    const endTime = new Date(b.endTime);
    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "endTime must be after startTime." } });
    }
    const shift = await prisma.eventShift.create({
      data: { eventId: req.event.id, teamMemberId: member.id, role: b.role ? String(b.role).slice(0, 60) : null, startTime, endTime, notes: b.notes ? String(b.notes).slice(0, 500) : null },
    });
    res.status(201).json(shift);
  });
  app.patch("/api/events/:id/shifts/:shiftId", requireEventAccess("MANAGER"), async (req, res) => {
    const existing = await prisma.eventShift.findUnique({ where: { id: req.params.shiftId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Shift not found" } });
    const patch = {};
    if (req.body?.startTime) patch.startTime = new Date(req.body.startTime);
    if (req.body?.endTime) patch.endTime = new Date(req.body.endTime);
    if (req.body?.role !== undefined) patch.role = req.body.role ? String(req.body.role).slice(0, 60) : null;
    if (req.body?.notes !== undefined) patch.notes = req.body.notes ? String(req.body.notes).slice(0, 500) : null;
    const updated = await prisma.eventShift.update({ where: { id: existing.id }, data: patch });
    res.json(updated);
  });
  app.delete("/api/events/:id/shifts/:shiftId", requireEventAccess("MANAGER"), async (req, res) => {
    const existing = await prisma.eventShift.findUnique({ where: { id: req.params.shiftId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Shift not found" } });
    await prisma.eventShift.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // Accepting requires the signed-in Clerk user's email to match the invited
  // address; the invite token alone is not enough to grant event access.
  app.post("/api/team/invites/:token/accept", requireAuth, async (req, res) => {
    const invite = await db.getInviteByToken(req.params.token);
    if (!invite || invite.status !== "PENDING") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "This invite link is invalid or already used" } });
    }
    if (req.user.email.toLowerCase() !== invite.invitedEmail.toLowerCase()) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Sign in with the invited email address to accept this invite" } });
    }
    const accepted = await db.acceptInvite(req.params.token, req.user.id);
    await db.audit("event.team.accept", { actorId: req.user.id, entityType: "event", entityId: invite.eventId, metadata: { role: invite.role } });
    res.json({ ok: true, eventId: accepted.eventId, eventTitle: invite.event.title, role: accepted.role });
  });

  // ---- organizer-wide team (see db.organizerTeamMembers's comment — not a
  // new access-control concept, just a bulk per-event invite/revoke) ----
  app.get("/api/organizer/team", requireAuth, async (req, res) => {
    res.json(await db.organizerTeamMembers(req.user.id));
  });
  app.post("/api/organizer/team/invite", teamInviteLimiter, requireAuth, async (req, res) => {
    const { email, role } = req.body || {};
    if (!email || !["MANAGER", "STAFF"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "email and role (MANAGER or STAFF) are required" } });
    }
    const invites = await db.organizerTeamInvite({ userId: req.user.id, email, role, invitedBy: req.user.id });
    if (!invites.length) return res.status(400).json({ error: { code: "NO_EVENTS", message: "You don't have any active events to invite them to yet." } });
    await db.audit("organizer.team.invite", { actorId: req.user.id, entityType: "user", entityId: req.user.id, metadata: { email, role, eventCount: invites.length } });
    const origin = publicOrigin(req);
    if (emailConfigured()) {
      const events = await Promise.all(invites.map((inv) => db.get(inv.eventId)));
      sendEmail({
        to: email,
        ...organizerTeamInviteEmail({
          organizerName: req.user.name, role,
          events: invites.map((inv, i) => ({ title: events[i]?.title || "an event", inviteLink: `${origin}/invite/${inv.inviteToken}` })),
        }),
      }).catch((err) => console.error("organizer team invite email failed:", err.message));
    }
    res.status(201).json({ ok: true, eventCount: invites.length });
  });
  app.delete("/api/organizer/team/:email", requireAuth, async (req, res) => {
    await db.organizerTeamRevoke(req.user.id, req.params.email);
    await db.audit("organizer.team.revoke", { actorId: req.user.id, entityType: "user", entityId: req.user.id, metadata: { email: req.params.email } });
    res.json({ ok: true });
  });

  // ---- following organizers (see schema.prisma's Follow comment) ----
  app.post("/api/organizers/:id/follow", socialLimiter, requireAuth, async (req, res) => {
    const targetId = req.params.id;
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Organizer not found" } });
    try {
      await db.followOrganizer(req.user.id, targetId);
    } catch (e) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: e.message } });
    }
    res.status(201).json({ ok: true, followerCount: await db.followerCount(targetId) });
  });

  app.delete("/api/organizers/:id/follow", requireAuth, async (req, res) => {
    await db.unfollowOrganizer(req.user.id, req.params.id);
    res.json({ ok: true, followerCount: await db.followerCount(req.params.id) });
  });

  app.get("/api/organizers/:id/follow", requireAuth, async (req, res) => {
    res.json({
      following: await db.isFollowing(req.user.id, req.params.id),
      followerCount: await db.followerCount(req.params.id),
    });
  });

  // events from everyone the signed-in user follows — the actual payoff
  // of the follow graph, surfaced as its own feed rather than just a count
  app.get("/api/me/following-feed", requireAuth, async (req, res) => {
    res.json(await db.followingFeed(req.user.id));
  });

  // ---- collections (Pinterest-style saved lists, see schema.prisma) ----
  // Ownership is enforced inline rather than via a requireX middleware
  // family like events get — collections are a much smaller surface (no
  // team roles, no staff access), a plain id-match check is proportionate.
  async function loadOwnedCollection(req, res, next) {
    const c = await prisma.collection.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Collection not found" } });
    if (c.ownerId !== req.user.id) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your collection" } });
    req.collection = c;
    next();
  }

  app.post("/api/collections", socialLimiter, requireAuth, async (req, res) => {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
    res.status(201).json(await db.createCollection(req.user.id, name));
  });

  app.get("/api/collections", requireAuth, async (req, res) => {
    res.json(await db.listMyCollections(req.user.id));
  });

  // public — a collection's whole point is to be shareable via its link,
  // gated only by isPublic (not by who's asking)
  app.get("/api/collections/:id", async (req, res) => {
    const c = await db.getCollection(req.params.id, req.user?.id || null);
    if (!c || (!c.isPublic && c.ownerId !== req.user?.id)) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Collection not found" } });
    }
    res.json(c);
  });

  app.patch("/api/collections/:id", requireAuth, loadOwnedCollection, async (req, res) => {
    const { name, isPublic } = req.body || {};
    if (name !== undefined) await db.renameCollection(req.params.id, name);
    if (isPublic !== undefined) await prisma.collection.update({ where: { id: req.params.id }, data: { isPublic: !!isPublic } });
    res.json(await db.getCollection(req.params.id, req.user.id));
  });

  app.delete("/api/collections/:id", requireAuth, loadOwnedCollection, async (req, res) => {
    await db.deleteCollection(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/collections/:id/items", requireAuth, loadOwnedCollection, async (req, res) => {
    const { eventId } = req.body || {};
    if (!eventId) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "eventId is required" } });
    await db.addToCollection(req.params.id, eventId);
    res.status(201).json(await db.getCollection(req.params.id, req.user.id));
  });

  app.delete("/api/collections/:id/items/:eventId", requireAuth, loadOwnedCollection, async (req, res) => {
    await db.removeFromCollection(req.params.id, req.params.eventId);
    res.json(await db.getCollection(req.params.id, req.user.id));
  });

  app.post("/api/admin/events/:id/moderate", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const action = req.body?.action;
    if (action === "cancel") {
      const updated = await db.update(e.id, { cancelled: true });
      await db.audit("admin.event.cancel", { actorId: req.user.id, entityType: "event", entityId: e.id });
      return res.json(updated);
    }
    if (action === "remove") {
      await db.remove(e.id);
      await db.audit("admin.event.remove", { actorId: req.user.id, entityType: "event", entityId: e.id });
      return res.json({ ok: true });
    }
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be 'cancel' or 'remove'" } });
  });

  // ADMIN-only role management — grants/revokes ORGANIZER/ADMIN. Bumps
  // tokenVersion so any session the user already has stops working
  // immediately rather than waiting up to 30 days for the old JWT to expire.
  app.post("/api/admin/users/:id/role", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const role = req.body?.role;
    if (!["ATTENDEE", "ORGANIZER", "ADMIN"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "role must be ATTENDEE, ORGANIZER, or ADMIN" } });
    }
    const target = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    await db.revokeSessions(target.id);
    await db.audit("admin.user.role", { actorId: req.user.id, entityType: "user", entityId: target.id, metadata: { role } });
    res.json({ id: target.id, email: target.email, role: target.role });
  });

  // ---- reports (moderation queue, see schema.prisma's Report comment) ----
  // Reporting itself needs no auth — an anonymous visitor can flag something —
  // but reviewing/resolving the queue is admin-only, same as event moderation.
  app.post("/api/reports", reportLimiter, async (req, res) => {
    const { entityType, entityId, reason, note } = req.body || {};
    if (!["event", "organizer", "user"].includes(entityType) || !entityId || !reason) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "entityType, entityId, and reason are required" } });
    }
    const report = await db.createReport({ reporterId: req.user?.id || null, entityType, entityId, reason, note });
    res.status(201).json({ id: report.id });
  });

  app.get("/api/admin/reports", requireAuth, requireRole("ADMIN"), async (_req, res) => {
    res.json(await db.listOpenReports());
  });

  app.post("/api/admin/reports/:id/resolve", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const status = ["REVIEWED", "DISMISSED", "ACTIONED"].includes(req.body?.status) ? req.body.status : "ACTIONED";
    const report = await db.resolveReport(req.params.id, req.user.id, status);
    await db.audit("admin.report.resolve", { actorId: req.user.id, entityType: "report", entityId: report.id, metadata: { status } });
    res.json(report);
  });

  app.get("/api/admin/metrics", requireAuth, requireRole("ADMIN"), async (_req, res) => {
    res.json(await db.platformMetrics());
  });

  // ---- waitlist.weynevents.com signups (see LandingWaitlistSignup in
  // schema.prisma — deliberately separate from the per-event WaitlistEntry
  // model used for sold-out tickets) ----
  app.get("/api/admin/waitlist-signups", requireAuth, requireRole("ADMIN"), async (_req, res) => {
    const rows = await prisma.landingWaitlistSignup.findMany({ orderBy: { createdAt: "desc" } });
    res.json(rows);
  });

  app.get("/api/admin/waitlist-signups.csv", requireAuth, requireRole("ADMIN"), async (_req, res) => {
    const rows = await prisma.landingWaitlistSignup.findMany({ orderBy: { createdAt: "desc" } });
    // Same CSV-injection guard as the attendee exports above — name/source
    // are visitor-supplied free text.
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ["Email,Name,Role,Source,Signed Up At"];
    for (const r of rows) {
      lines.push([escape(r.email), escape(r.name), escape(r.role), escape(r.source), escape(r.createdAt.toISOString())].join(","));
    }
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", 'attachment; filename="weyn-waitlist-signups.csv"');
    res.send(lines.join("\n"));
  });

  // ---- trust & safety review queue (see server/moderation.js) ----
  app.get("/api/admin/review-queue", requireAuth, requireRole("ADMIN"), async (_req, res) => {
    res.json(await db.listReviewQueue());
  });

  app.post("/api/admin/review-queue/:eventId/resolve", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const status = req.body?.status;
    if (!["APPROVED", "DISCOVERY_LIMITED", "DISCOVERY_BLOCKED"].includes(status)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be APPROVED, DISCOVERY_LIMITED, or DISCOVERY_BLOCKED" } });
    }
    const updated = await db.resolveModeration(req.params.eventId, status, req.user.id);
    res.json(updated);
  });

  // Identity itself now comes entirely from Clerk (frontend widgets +
  // attachUser's token verification above) — this just hands the frontend
  // the User row's app-side fields (role, id) that aren't part of the Clerk
  // session token, e.g. for gating the admin dashboard link.
  // Support contact form (src/pages/Support.tsx) — no dedicated inbox/ticket
  // system, just routes to the same notify address venue applications use,
  // which is a real setting (VENUE_APPLICATION_NOTIFY_EMAIL) rather than a
  // hardcoded one so it can point anywhere without a code change.
  app.post("/api/support", supportLimiter, async (req, res) => {
    const { subject, message } = req.body || {};
    if (!subject || !String(subject).trim() || !message || !String(message).trim()) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and message are required" } });
    }
    const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL || process.env.VENUE_APPLICATION_NOTIFY_EMAIL || "dhairyarsaluja@gmail.com";
    const fromLabel = req.user ? `${req.user.name} <${req.user.email}>` : "Signed-out visitor";
    await sendEmail({
      to: notifyTo,
      subject: `[Support] ${String(subject).trim()}`,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">New support message</h2>
        <p style="color:#888;font-size:13px;margin:0 0 16px">From: ${fromLabel}</p>
        <p style="white-space:pre-wrap;line-height:1.5;color:#222">${String(message).trim().replace(/</g, "&lt;")}</p>
      </div>`,
    }).catch((err) => captureError(err, { route: "POST /api/support" }));
    trackEvent(req.user?.id || null, "support_message_sent", {});
    res.status(201).json({ ok: true });
  });

  // waitlist.weynevents.com landing page — public, no auth (see
  // LandingWaitlistSignup in schema.prisma, deliberately separate from the
  // per-event WaitlistEntry model used for sold-out tickets).
  app.post("/api/waitlist", waitlistLimiter, async (req, res) => {
    const { email, name, role, source } = req.body || {};
    const trimmedEmail = String(email || "").trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email is required" } });
    }
    const trimmedName = name ? String(name).trim().slice(0, 120) : null;
    try {
      // create (not upsert) + catch the unique violation below — an upsert's
      // `update: {}` succeeds identically whether the email is brand new or
      // already on the list, with no way to tell which happened from the
      // result. That distinction matters here: welcome/notify emails must
      // fire once per person, not once per re-submission (a double form
      // click, or someone re-entering the same email a week later).
      await prisma.landingWaitlistSignup.create({
        data: { email: trimmedEmail, name: trimmedName, role: role ? String(role).slice(0, 40) : null, source: source ? String(source).slice(0, 120) : null },
      });
      trackEvent(null, "landing_waitlist_joined", { role: role || null, source: source || null });
      // Best-effort, same pattern as every other email in this file — a
      // Resend hiccup must never fail the signup itself.
      sendEmail({ to: trimmedEmail, ...waitlistWelcomeEmail({ name: trimmedName }) })
        .catch((err) => captureError(err, { route: "POST /api/waitlist", stage: "welcome-email" }));
      if (process.env.WAITLIST_NOTIFY_EMAIL) {
        prisma.landingWaitlistSignup.count()
          .then((count) => sendEmail({
            to: process.env.WAITLIST_NOTIFY_EMAIL,
            ...waitlistOwnerNotifyEmail({ email: trimmedEmail, name: trimmedName, role, source, count }),
          }))
          .catch((err) => captureError(err, { route: "POST /api/waitlist", stage: "owner-notify-email" }));
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      // Already on the list — same success response as a fresh signup
      // (the form has no way to tell the visitor apart from a first-timer,
      // and shouldn't), just no duplicate emails.
      if (err.code === "P2002") return res.status(201).json({ ok: true });
      captureError(err, { route: "POST /api/waitlist" });
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Couldn't join the waitlist — please try again." } });
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({ id: req.user.id, email: req.user.email, name: req.user.name, avatarUrl: req.user.avatarUrl, role: req.user.role });
  });

  // Organizer Pro — subscription dashboard data (plan, renewal date,
  // billing history, active features). Everyone currently resolves to an
  // active free "pro" grant (see features.js), so this endpoint already
  // exercises the real subscription model rather than a mocked response.
  app.get("/api/me/subscription", requireAuth, async (req, res) => {
    try {
      const sub = await ensureSubscription(req.user.id);
      const [plan, features, paymentHistory] = await Promise.all([
        prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } }),
        allFeatures(req.user.id),
        prisma.paymentHistory.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      ]);
      res.json({
        plan: { key: plan.key, name: plan.name, priceOmr: plan.priceOmr, billingPeriod: plan.billingPeriod },
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        pausedUntil: sub.pausedUntil,
        features,
        paymentHistory,
      });
    } catch (err) {
      captureError(err, { route: "GET /api/me/subscription", userId: req.user.id });
      res.status(500).json({ error: "Couldn't load subscription info" });
    }
  });

  // ---- Cancel flow: Trigger -> Survey -> Dynamic Offer -> Confirmation ----
  // No real billing wired yet (see Subscription.stripeSubscriptionId's
  // comment) — these routes update the same Subscription row the eventual
  // Stripe webhook handler will also write to (cancelAtPeriodEnd, status),
  // so nothing else needs to change when that lands. The exit-survey reason
  // is logged on every one of these three routes, not just a hard cancel,
  // so "reason distribution" and "offer acceptance rate" are measurable even
  // for saved customers.
  const CANCEL_REASONS = new Set(["too_expensive", "not_using", "missing_feature", "switching", "technical_issues", "temporary", "other"]);

  function validateCancelReason(req, res) {
    const reason = String(req.body?.reason || "").trim();
    if (!CANCEL_REASONS.has(reason)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Pick a reason from the list." } });
      return null;
    }
    return { reason, feedback: String(req.body?.feedback || "").trim().slice(0, 1000) || null };
  }

  // Confirmation step — organizer clicked through the survey and any save
  // offer and still wants to cancel. Sets cancelAtPeriodEnd rather than an
  // immediate status change: they keep Pro access through
  // currentPeriodEnd, same "cancel, don't lose what you paid for" behavior
  // Stripe's own subscription-cancel API gives you for free once wired up.
  app.post("/api/me/subscription/cancel", requireAuth, async (req, res) => {
    const parsed = validateCancelReason(req, res);
    if (!parsed) return;
    try {
      const sub = await ensureSubscription(req.user.id);
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { cancelReason: parsed.reason, cancelFeedback: parsed.feedback, cancelAtPeriodEnd: true },
      });
      res.json({ cancelAtPeriodEnd: updated.cancelAtPeriodEnd, currentPeriodEnd: updated.currentPeriodEnd });
    } catch (err) {
      captureError(err, { route: "POST /api/me/subscription/cancel", userId: req.user.id });
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Couldn't process the cancellation — try again shortly." } });
    }
  });

  // Save-offer accept path for "too expensive" / "missing feature" /
  // "switching" reasons — discount and downgrade aren't real billing
  // actions yet (no Stripe), so this just records which offer was accepted
  // and keeps the subscription active; wiring the actual discount/downgrade
  // into Stripe is the one thing left for when billing goes live.
  const RETENTION_OFFERS = new Set(["discount", "downgrade", "feature_unlock"]);
  app.post("/api/me/subscription/save", requireAuth, async (req, res) => {
    const parsed = validateCancelReason(req, res);
    if (!parsed) return;
    const offer = String(req.body?.offer || "").trim();
    if (!RETENTION_OFFERS.has(offer)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unknown offer." } });
    try {
      const sub = await ensureSubscription(req.user.id);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { cancelReason: parsed.reason, cancelFeedback: parsed.feedback, retentionOfferAccepted: offer, cancelAtPeriodEnd: false },
      });
      res.json({ ok: true, offer });
    } catch (err) {
      captureError(err, { route: "POST /api/me/subscription/save", userId: req.user.id });
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Couldn't apply that offer — try again shortly." } });
    }
  });

  // Save-offer accept path for "not using enough" / "temporary" reasons —
  // pauses Pro access (status flips to SUSPENDED, which features.js's
  // isActive() already treats as "no access") until pausedUntil, then
  // features.js's ensureSubscription() auto-resumes it on next read — no
  // cron needed.
  app.post("/api/me/subscription/pause", requireAuth, async (req, res) => {
    const parsed = validateCancelReason(req, res);
    if (!parsed) return;
    const months = Number(req.body?.months);
    if (!Number.isInteger(months) || months < 1 || months > 3) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Pick a pause length between 1 and 3 months." } });
    }
    try {
      const sub = await ensureSubscription(req.user.id);
      const pausedUntil = new Date();
      pausedUntil.setMonth(pausedUntil.getMonth() + months);
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          cancelReason: parsed.reason, cancelFeedback: parsed.feedback,
          retentionOfferAccepted: "pause", cancelAtPeriodEnd: false,
          status: "SUSPENDED", pausedUntil,
        },
      });
      res.json({ status: updated.status, pausedUntil: updated.pausedUntil });
    } catch (err) {
      captureError(err, { route: "POST /api/me/subscription/pause", userId: req.user.id });
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Couldn't pause the subscription — try again shortly." } });
    }
  });

  // Post-cancel / early-unpause path — "I changed my mind" before
  // currentPeriodEnd, or resuming early from a pause. Doesn't touch
  // cancelReason/retentionOfferAccepted — those stay as the historical
  // record of what happened last time, for cohort analysis.
  app.post("/api/me/subscription/resume", requireAuth, async (req, res) => {
    try {
      const sub = await ensureSubscription(req.user.id);
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE", pausedUntil: null, cancelAtPeriodEnd: false },
      });
      res.json({ status: updated.status });
    } catch (err) {
      captureError(err, { route: "POST /api/me/subscription/resume", userId: req.user.id });
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Couldn't resume the subscription — try again shortly." } });
    }
  });

  // Account deletion — soft-delete (deletedAt), same pattern every read path
  // in db.js already filters on (User/Event both already respect
  // `deletedAt: null`, see db.js:459,244 etc), so this doesn't need new
  // filtering logic elsewhere, only to actually set the column. Cancels any
  // events the user owns so nothing live is left behind with a deleted
  // owner, and clears push subscriptions so a deleted user's devices stop
  // receiving notifications immediately. Does NOT touch venues they own —
  // those are real businesses with their own guests/reservations and
  // shouldn't vanish because the account that applied for them was deleted;
  // ownership transfer is a manual admin action, not automatic.
  // Clerk still owns the actual session — the frontend calls Clerk's
  // signOut() right after this succeeds; revokeSessions() below only stops
  // this app's own token-version check from trusting an old token in the
  // meantime.
  app.delete("/api/me", requireAuth, async (req, res) => {
    const userId = req.user.id;
    try {
      await prisma.$transaction([
        prisma.event.updateMany({ where: { ownerId: userId, cancelled: false }, data: { cancelled: true } }),
        prisma.webPushSubscription.deleteMany({ where: { userId } }),
        prisma.pushToken.updateMany({ where: { userId }, data: { userId: null } }),
        prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date(), email: `deleted+${userId}@weynevents.com`, name: "Deleted user" } }),
      ]);
      await db.revokeSessions(userId);
      await db.audit("user.delete_account", { actorId: userId, entityType: "user", entityId: userId });
      res.json({ ok: true });
    } catch (err) {
      captureError(err, { route: "DELETE /api/me", userId });
      res.status(500).json({ error: "Couldn't delete your account. Please try again." });
    }
  });

  // OneSignal manages its own device registration/subscription client-side
  // (the native Cordova plugin and the web SDK both talk to OneSignal
  // directly — see src/push.ts), so this app no longer collects or stores
  // raw push tokens or VAPID subscriptions itself. The old
  // POST /api/push/register, GET /api/push/vapid-public-key,
  // POST /api/push/web-subscribe, and POST /api/push/web-unsubscribe routes
  // are removed. db.upsertPushToken/tokenForDevice/tokensForUser and the
  // PushToken/WebPushSubscription Prisma models are left in place (not
  // migrated away) but are now dead code — a candidate for later cleanup
  // once OneSignal has been live for a while.
  app.get("/api/push/status", (_req, res) => res.json({ configured: oneSignalConfigured() }));

  // ADMIN-only: fires a real push at a Weyn userId via OneSignal, so leaving
  // it open let anyone spam notifications. It's a debugging tool, not a
  // user-facing endpoint.
  app.post("/api/push/test", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const result = await sendOneSignalPush(userId, { title: "Weyn", body: "Test notification — if you see this, push works! 🎉" });
    res.json(result);
  });

  // Public organizer profile — the destination the Follow feature was
  // missing (follow buttons existed with nowhere to send people). Keyed by
  // User.id, not display name (unlike the old /api/organizer/:name/summary
  // this replaces, which also had no auth check and leaked gross revenue to
  // anyone who guessed a display name — removed, not just superseded).
  app.get("/api/organizers/:id", async (req, res) => {
    const profile = await db.getOrganizerProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Organizer not found" } });
    res.json({
      ...profile,
      isFollowing: req.user ? await db.isFollowing(req.user.id, req.params.id) : false,
    });
  });

  app.post("/api/import/instagram", importLimiter, requireAuth, async (req, res) => {
    const { url, caption: pastedCaption } = req.body || {};
    try {
      let caption = pastedCaption;
      let imageUrl = null;
      if (!caption && url) {
        const scraped = await scrapeInstagramPost(url);
        caption = scraped.caption;
        imageUrl = scraped.imageUrl;
      }
      if (!caption) return res.status(400).json({ error: "Provide a url or a caption", needsCaption: true });

      const parsed = await parseEventFromCaption(caption);
      let imagePath = null;
      if (imageUrl) imagePath = await downloadImage(imageUrl, storage);

      res.json({
        title: parsed.title,
        blurb: parsed.blurb,
        tags: parsed.tags,
        startsAt: parsed.startsAt || null,
        imagePath,
        sourceUrl: url || null,
        aiParsed: parsed.aiParsed,
      });
    } catch (err) {
      res.status(err.needsCaption ? 422 : 500).json({ error: err.message, needsCaption: !!err.needsCaption });
    }
  });

  app.get("/api/events/:id/marketing", requireEventOwner(), async (req, res) => {
    const e = req.event;
    let copy = await db.getMarketing(e.id);
    if (!copy) {
      const brandKit = e.ownerId ? await prisma.organizerBrandKit.findUnique({ where: { organizerId: e.ownerId } }) : null;
      copy = await generateMarketingCopy(e, brandKit);
      await db.setMarketing(e.id, copy);
    }
    res.json(copy);
  });

  // importLimiter (shared LLM-cost bucket): regenerate makes a paid model
  // call, so cap it even though it's owner-gated — stops an owner from
  // hammering it to run up API cost.
  app.post("/api/events/:id/marketing/regenerate", importLimiter, requireEventOwner(), async (req, res) => {
    const brandKit = req.event.ownerId ? await prisma.organizerBrandKit.findUnique({ where: { organizerId: req.event.ownerId } }) : null;
    const copy = await generateMarketingCopy(req.event, brandKit);
    await db.setMarketing(req.event.id, copy);
    res.json(copy);
  });

  // ---- Marketing Hub: UTM link builder ----
  app.post("/api/events/:id/marketing-links", requireEventOwner(), requireFeature("utmLinkBuilder"), async (req, res) => {
    const b = req.body || {};
    const label = String(b.label || "").trim();
    const utmSource = String(b.utmSource || "").trim();
    const utmMedium = String(b.utmMedium || "").trim();
    const utmCampaign = String(b.utmCampaign || "").trim();
    if (!label || !utmSource || !utmMedium || !utmCampaign) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "label, utmSource, utmMedium, and utmCampaign are all required" } });
    }
    const params = new URLSearchParams({ utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign });
    const url = `${req.protocol}://${req.get("host")}/e/${req.event.id}?${params.toString()}`;
    const created = await prisma.marketingLink.create({
      data: { eventId: req.event.id, organizerId: req.user.id, label, utmSource, utmMedium, utmCampaign, url },
    });
    res.status(201).json(created);
  });
  app.get("/api/events/:id/marketing-links", requireEventOwner(), requireFeature("utmLinkBuilder"), async (req, res) => {
    res.json(await prisma.marketingLink.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "desc" } }));
  });
  app.delete("/api/events/:id/marketing-links/:linkId", requireEventOwner(), requireFeature("utmLinkBuilder"), async (req, res) => {
    const existing = await prisma.marketingLink.findUnique({ where: { id: req.params.linkId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Link not found" } });
    await prisma.marketingLink.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // ---- Marketing Hub: referral program ----
  // "Enable referral tracking" just means "the organizer has created at
  // least one code" — there's no separate on/off toggle on Event, matching
  // the spec's "keep it simple" instruction (no real payout mechanism).
  app.post("/api/events/:id/referral-codes", requireEventOwner(), requireFeature("referralPrograms"), async (req, res) => {
    const b = req.body || {};
    const ownerName = b.ownerName ? String(b.ownerName).trim() : null;
    const ownerEmail = b.ownerEmail ? String(b.ownerEmail).trim() : null;
    // Short, URL-safe, human-shareable code — collision retry rather than a
    // long opaque id, since this is meant to be typed/read aloud too.
    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = crypto.randomBytes(4).toString("hex").toUpperCase();
      const clash = await prisma.referralCode.findUnique({ where: { code } });
      if (!clash) break;
    }
    const created = await prisma.referralCode.create({
      data: { eventId: req.event.id, organizerId: req.user.id, code, ownerName, ownerEmail },
    });
    res.status(201).json(created);
  });
  app.get("/api/events/:id/referral-codes", requireEventOwner(), requireFeature("referralPrograms"), async (req, res) => {
    res.json(await prisma.referralCode.findMany({ where: { eventId: req.event.id }, orderBy: { referralCount: "desc" } }));
  });
  // Leaderboard — same data as the list above, ranked, capped to a sane
  // top-N for the UI. Kept as its own route (rather than a query param) so
  // it reads clearly from the frontend call site.
  app.get("/api/events/:id/referral-codes/leaderboard", requireEventOwner(), requireFeature("referralPrograms"), async (req, res) => {
    const codes = await prisma.referralCode.findMany({
      where: { eventId: req.event.id },
      orderBy: { referralCount: "desc" },
      take: 50,
    });
    res.json(codes);
  });
  app.delete("/api/events/:id/referral-codes/:codeId", requireEventOwner(), requireFeature("referralPrograms"), async (req, res) => {
    const existing = await prisma.referralCode.findUnique({ where: { id: req.params.codeId } });
    if (!existing || existing.eventId !== req.event.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Referral code not found" } });
    await prisma.referralCode.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // ---- Marketing Hub: cross-event marketing calendar ----
  // Reuses the exact same T-7/T-3/T-1/day-of dates as the per-event
  // Marketing tab (server/marketing.js's scheduleDates) but across every
  // event this organizer owns/manages, so they can see the whole slate's
  // posting calendar in one place.
  app.get("/api/organizer/marketing-calendar", requireAuth, requireFeature("marketingCalendar"), async (req, res) => {
    const events = await db.eventsAccessibleTo(req.user.id);
    const items = [];
    for (const e of events) {
      if (e.cancelled) continue;
      const dates = scheduleDates(e);
      const labels = { "T-7": "One week out", "T-3": "3 days left", "T-1": "Tomorrow", "Day-of": "Today" };
      for (const stage of ["T-7", "T-3", "T-1", "Day-of"]) {
        items.push({ eventId: e.id, eventTitle: e.title, stage, label: labels[stage], date: dates[stage] });
      }
    }
    items.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(items);
  });

  // ---- Marketing Hub: brand kit ----
  app.get("/api/me/brand-kit", requireAuth, requireFeature("brandKit"), async (req, res) => {
    const kit = await prisma.organizerBrandKit.findUnique({ where: { organizerId: req.user.id } });
    res.json(kit || { organizerId: req.user.id, logoUrl: null, primaryColor: null, toneOfVoice: null });
  });
  app.put("/api/me/brand-kit", requireAuth, requireFeature("brandKit"), async (req, res) => {
    const b = req.body || {};
    const data = {
      logoUrl: b.logoUrl ? String(b.logoUrl).trim() : null,
      primaryColor: b.primaryColor ? String(b.primaryColor).trim() : null,
      toneOfVoice: b.toneOfVoice ? String(b.toneOfVoice).trim() : null,
    };
    const kit = await prisma.organizerBrandKit.upsert({
      where: { organizerId: req.user.id },
      create: { organizerId: req.user.id, ...data },
      update: data,
    });
    res.json(kit);
  });

  // ---- Organizer social/email growth suite ----
  // Real connect-and-send on top of the copy-only Marketing Hub above:
  // Meta (Instagram + Facebook) account connection + posting, and an
  // organizer-owned email subscriber list + real campaign sends. Parked
  // integration pattern (see server/email.js's Resend wrapper) — every
  // Meta-touching route below checks metaConfigured() first and returns a
  // typed 503 instead of ever reaching real Graph API calls, since
  // META_APP_ID/META_APP_SECRET/META_REDIRECT_URI are unset in every
  // environment today.

  function integrationErrorResponse(err, res) {
    if (err instanceof IntegrationNotConfiguredError || err.code === "INTEGRATION_NOT_CONFIGURED") {
      return res.status(503).json({ error: { code: "INTEGRATION_NOT_CONFIGURED", message: err.message } });
    }
    return null;
  }

  // Short-lived CSRF state store for the Meta OAuth round trip — nonce ->
  // userId, same shape/reasoning as auth.js's userCache (process-local,
  // best-effort on Cloudflare, bounded, correctness doesn't depend on size).
  const metaOAuthState = new Map();
  const META_STATE_TTL_MS = 10 * 60_000;
  function pruneMetaOAuthState() {
    const now = Date.now();
    for (const [k, v] of metaOAuthState) if (v.expires < now) metaOAuthState.delete(k);
  }

  app.get("/api/me/social-accounts", requireAuth, async (req, res) => {
    const rows = await prisma.socialAccountConnection.findMany({ where: { userId: req.user.id } });
    // Never return the encrypted token to the client — connection status only.
    res.json(rows.map(({ accessTokenEnc, ...rest }) => rest));
  });

  app.get("/api/me/social-accounts/meta/connect", requireAuth, async (req, res) => {
    try {
      pruneMetaOAuthState();
      const state = crypto.randomBytes(16).toString("hex");
      metaOAuthState.set(state, { userId: req.user.id, expires: Date.now() + META_STATE_TTL_MS });
      const url = buildMetaOAuthUrl(state);
      res.redirect(url);
    } catch (err) {
      const handled = integrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "GET /api/me/social-accounts/meta/connect" }); res.status(500).json({ error: err.message }); }
    }
  });

  app.get("/api/me/social-accounts/meta/callback", requireAuth, async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;
      if (oauthError) return res.status(400).json({ error: { code: "OAUTH_DENIED", message: String(oauthError) } });
      pruneMetaOAuthState();
      const stateEntry = state && metaOAuthState.get(String(state));
      if (!stateEntry || stateEntry.userId !== req.user.id) {
        return res.status(400).json({ error: { code: "INVALID_STATE", message: "OAuth state missing, expired, or mismatched — please try connecting again." } });
      }
      metaOAuthState.delete(String(state));
      if (!code) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Missing code from Meta" } });

      const conn = await exchangeCodeForConnection(String(code));
      const saved = await prisma.socialAccountConnection.upsert({
        where: { userId_provider: { userId: req.user.id, provider: "meta" } },
        create: { userId: req.user.id, provider: "meta", ...conn },
        update: conn,
      });
      await db.audit("social.connect", { actorId: req.user.id, entityType: "socialAccountConnection", entityId: saved.id, metadata: { provider: "meta" } });
      res.redirect("/organizer/marketing?connected=meta");
    } catch (err) {
      const handled = integrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "GET /api/me/social-accounts/meta/callback" }); res.status(500).json({ error: err.message }); }
    }
  });

  app.delete("/api/me/social-accounts/meta/:id", requireAuth, async (req, res) => {
    const existing = await prisma.socialAccountConnection.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
    await prisma.socialAccountConnection.delete({ where: { id: existing.id } });
    await db.audit("social.disconnect", { actorId: req.user.id, entityType: "socialAccountConnection", entityId: existing.id, metadata: { provider: existing.provider } });
    res.json({ ok: true });
  });

  // ---- Real posting: Instagram, via the organizer's connected Meta account ----
  app.post("/api/events/:id/marketing/post-to-instagram", socialLimiter, requireEventOwner(), requireFeature("socialAutoPosting"), async (req, res) => {
    try {
      const e = req.event;
      const connection = await prisma.socialAccountConnection.findUnique({ where: { userId_provider: { userId: req.user.id, provider: "meta" } } });
      if (!connection) return res.status(400).json({ error: { code: "NOT_CONNECTED", message: "Connect your Instagram/Facebook account first." } });
      if (!e.image) return res.status(400).json({ error: { code: "NO_IMAGE", message: "This event needs a cover image before it can be posted." } });

      const b = req.body || {};
      const caption = String(b.caption || "").trim();
      if (!caption) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "caption is required" } });

      // Best-effort double-post guard, not a hard lock — an organizer who
      // genuinely wants to post the same event twice (e.g. a reminder
      // closer to the date) can still confirm through; this just warns.
      if (!b.confirmRepost) {
        const already = await prisma.socialPost.findFirst({ where: { eventId: e.id, provider: "instagram", status: "posted" } });
        if (already) return res.status(409).json({ error: { code: "ALREADY_POSTED", message: "This event was already posted to Instagram. Pass confirmRepost:true to post again anyway." }, previousPost: already });
      }

      let result;
      try {
        result = await publishInstagramPost(connection, { imageUrl: e.image, caption });
      } catch (err) {
        await prisma.socialPost.create({ data: { eventId: e.id, organizerId: req.user.id, provider: "instagram", copy: { caption, imageUrl: e.image }, status: "failed", error: err.message } });
        throw err;
      }
      const post = await prisma.socialPost.create({
        data: { eventId: e.id, organizerId: req.user.id, provider: "instagram", externalPostId: result.externalPostId, copy: { caption, imageUrl: e.image }, status: "posted" },
      });
      await db.audit("event.social_post", { actorId: req.user.id, entityType: "event", entityId: e.id, metadata: { provider: "instagram", postId: post.id } });
      res.status(201).json(post);
    } catch (err) {
      const handled = integrationErrorResponse(err, res);
      if (!handled) { captureError(err, { route: "POST /api/events/:id/marketing/post-to-instagram", eventId: req.params.id }); res.status(500).json({ error: err.message }); }
    }
  });

  app.get("/api/events/:id/marketing/social-posts", requireEventOwner(), requireFeature("socialAutoPosting"), async (req, res) => {
    res.json(await prisma.socialPost.findMany({ where: { eventId: req.event.id }, orderBy: { postedAt: "desc" } }));
  });

  // ---- Real email lists: organizer-owned MarketingContact subscriber list ----
  function newUnsubscribeToken() {
    return crypto.randomBytes(24).toString("base64url");
  }

  app.get("/api/me/marketing-contacts", requireAuth, requireFeature("emailCampaigns"), async (req, res) => {
    res.json(await prisma.marketingContact.findMany({ where: { organizerId: req.user.id }, orderBy: { createdAt: "desc" } }));
  });

  app.post("/api/me/marketing-contacts", requireAuth, requireFeature("emailCampaigns"), async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name).trim() : null;
    // Birthday/anniversary reminder automation — only month/day matter for
    // the "contact_birthday" AutomationRule trigger; year can be a
    // placeholder if the organizer doesn't know it.
    const birthday = req.body?.birthday && !isNaN(new Date(req.body.birthday).getTime()) ? new Date(req.body.birthday) : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email is required" } });
    }
    try {
      const contact = await prisma.marketingContact.upsert({
        where: { organizerId_email: { organizerId: req.user.id, email } },
        create: { organizerId: req.user.id, email, name, birthday, source: "manual", unsubscribeToken: newUnsubscribeToken() },
        update: { name: name ?? undefined, birthday: birthday ?? undefined, subscribed: true },
      });
      res.status(201).json(contact);
    } catch (err) {
      captureError(err, { route: "POST /api/me/marketing-contacts" });
      res.status(500).json({ error: err.message });
    }
  });

  // CSV import — plain "email,name" rows (a header row is auto-detected and
  // skipped), deduped by email against this organizer's existing list.
  // Deliberately a hand-rolled line parser (no quoted-field/embedded-comma
  // support) rather than pulling in a new dependency for a two-column
  // format — matches this codebase's existing CSV *export* routes, which
  // are all similarly simple `join(",")` builders with no library either.
  app.post("/api/me/marketing-contacts/import", requireAuth, requireFeature("emailCampaigns"), async (req, res) => {
    const raw = String(req.body?.csv || "");
    if (!raw.trim()) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "csv text is required" } });
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const seen = new Map(); // email -> name, last one wins, dedupes within the file itself
    for (const line of lines) {
      const [rawEmail, rawName] = line.split(",");
      const email = String(rawEmail || "").trim().toLowerCase();
      if (!email || email === "email" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue; // skips header row + junk lines
      seen.set(email, rawName ? String(rawName).trim() : null);
    }
    let imported = 0;
    let skipped = 0;
    for (const [email, name] of seen) {
      try {
        await prisma.marketingContact.upsert({
          where: { organizerId_email: { organizerId: req.user.id, email } },
          create: { organizerId: req.user.id, email, name, source: "csv_import", unsubscribeToken: newUnsubscribeToken() },
          update: { name: name ?? undefined },
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped, total: seen.size });
  });

  app.delete("/api/me/marketing-contacts/:id", requireAuth, requireFeature("emailCampaigns"), async (req, res) => {
    const existing = await prisma.marketingContact.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizerId !== req.user.id) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } });
    await prisma.marketingContact.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  });

  // Public, no-auth, one-click unsubscribe — a real legal requirement for
  // bulk email, not decorative. Idempotent (already-unsubscribed clicking
  // again just re-confirms) and never reveals whether a token was valid vs
  // reused beyond a generic message, so it can't be used to enumerate emails.
  app.get("/api/marketing-contacts/unsubscribe/:token", async (req, res) => {
    const contact = await prisma.marketingContact.findUnique({ where: { unsubscribeToken: req.params.token } });
    if (contact) await prisma.marketingContact.update({ where: { id: contact.id }, data: { subscribed: false } });
    res.set("Content-Type", "text/html");
    res.send(`<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 24px;text-align:center"><h2>You're unsubscribed</h2><p style="color:#666">You won't receive marketing emails from this organizer again.</p></body></html>`);
  });

  // ---- Real campaign send: the AI-drafted email copy, sent to the
  // organizer's subscribed MarketingContact list via server/email.js's
  // sendEmail()/Resend wrapper. Batched in fixed-size chunks (rather than
  // one giant Promise.all like sendEventNotificationNow's smaller
  // ticket-buyer fan-out) since a subscriber list can be much larger than
  // one event's attendee list. ----
  const EMAIL_BATCH_SIZE = 25;
  app.post("/api/events/:id/marketing/send-email-campaign", socialLimiter, requireEventOwner(), requireFeature("emailCampaigns"), async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const bodyText = String(req.body?.body || "").trim();
    if (!subject || !bodyText) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and body are required" } });

    const contacts = await prisma.marketingContact.findMany({ where: { organizerId: req.user.id, subscribed: true } });
    const safeBody = bodyText.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let sent = 0;
    for (let i = 0; i < contacts.length; i += EMAIL_BATCH_SIZE) {
      const batch = contacts.slice(i, i + EMAIL_BATCH_SIZE);
      await Promise.all(batch.map((c) => {
        const unsubUrl = `${req.protocol}://${req.get("host")}/api/marketing-contacts/unsubscribe/${c.unsubscribeToken}`;
        return sendEmail({
          to: c.email,
          subject,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p style="white-space:pre-wrap;line-height:1.6;color:#222">${safeBody}</p><p style="color:#999;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">You're receiving this because you're on this organizer's mailing list. <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p></div>`,
        }).then(() => { sent++; }).catch((err) => captureError(err, { route: "POST /api/events/:id/marketing/send-email-campaign", eventId: req.event.id }));
      }));
    }

    const record = await prisma.emailCampaignSend.create({
      data: { organizerId: req.user.id, eventId: req.event.id, subject, bodyHtml: safeBody, recipientCount: sent },
    });
    await db.audit("event.email_campaign", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { subject, recipients: contacts.length, sent } });
    res.status(201).json({ ok: true, recipients: contacts.length, sent, campaign: record });
  });

  app.get("/api/organizer/email-campaign-sends", requireAuth, requireFeature("emailCampaigns"), async (req, res) => {
    res.json(await prisma.emailCampaignSend.findMany({ where: { organizerId: req.user.id }, orderBy: { sentAt: "desc" }, take: 100 }));
  });

  // ---- Growth tools ----
  app.get("/api/events/:id/marketing/growth-ideas", importLimiter, requireEventOwner(), async (req, res) => {
    try {
      res.json({ ideas: await generateGrowthIdeas(req.event) });
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/marketing/growth-ideas", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/events/:id/marketing/free-tool-ideas", importLimiter, requireEventOwner(), async (req, res) => {
    try {
      res.json({ ideas: await generateFreeToolIdeas(req.event) });
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/marketing/free-tool-ideas", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Psychology-informed copy variants — re-angle the existing ad/social
  // copy through a chosen persuasion lens, a toggle in the UI rather than
  // a new page.
  app.get("/api/events/:id/marketing/angled-copy", importLimiter, requireEventOwner(), async (req, res) => {
    const angle = String(req.query.angle || "");
    if (!PERSUASION_ANGLE_KEYS.includes(angle)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `angle must be one of: ${PERSUASION_ANGLE_KEYS.join(", ")}` } });
    }
    try {
      const brandKit = req.event.ownerId ? await prisma.organizerBrandKit.findUnique({ where: { organizerId: req.event.ownerId } }) : null;
      res.json(await generateAngledCopy(req.event, brandKit, angle));
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/marketing/angled-copy", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk ad creative — "generate more variants" for A/B testing at scale,
  // on top of the fixed-3 googleAdVariants/metaAdVariants already cached
  // on MarketingAsset.
  app.get("/api/events/:id/marketing/bulk-ad-variants", importLimiter, requireEventOwner(), async (req, res) => {
    const platform = req.query.platform === "google" ? "google" : "meta";
    const count = Math.min(10, Math.max(1, parseInt(req.query.count, 10) || 3));
    try {
      const brandKit = req.event.ownerId ? await prisma.organizerBrandKit.findUnique({ where: { organizerId: req.event.ownerId } }) : null;
      const variants = await generateBulkAdVariants(req.event, brandKit, { platform, count });
      res.json({ platform, variants });
    } catch (err) {
      captureError(err, { route: "GET /api/events/:id/marketing/bulk-ad-variants", eventId: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  // catch-all error handler — multer/upload errors land here (4xx, not
  // worth alerting on), anything else is an unexpected server-side failure
  // worth seeing in Sentry. Note: Express 4 only reaches this for errors
  // passed to next(err) or thrown synchronously — a *rejected promise*
  // inside an async route handler that never awaits/catches internally
  // will NOT reach this handler (a known Express 4 gap, fixed in Express 5).
  // Every route in this file so far wraps its body in try/catch and replies
  // itself; keep doing that for new routes rather than relying on this.
  app.use((err, _req, res, _next) => {
    const isClientError = err.status && err.status < 500;
    if (!isClientError) captureError(err);
    res.status(err.status || 400).json({ error: err.message || "Something went wrong" });
  });

  // ---- real SEO: server-rendered meta tags for shared event links ----
  // vercel.json rewrites /e/:id here specifically (every other client route
  // gets Vercel's static SPA fallback directly, skipping this function for
  // speed). This only works now that the web build uses BrowserRouter
  // (main.tsx) — with the old HashRouter, the id after "#" never reached
  // the server at all, making this structurally impossible.
  const DIST_DIR = __dirname && path.join(__dirname, "..", "dist");
  app.get("/e/:id", async (req, res, next) => {
    try {
      // local dev / any environment where dist/ is on disk — read directly.
      // On Vercel the function bundle doesn't include dist/ (it's deployed
      // separately as static output), so self-fetch the real built HTML
      // from this same deployment instead — always in sync with whatever
      // was actually built, no hardcoded hashed asset filenames to maintain.
      let html;
      if (DIST_DIR && fs.existsSync(path.join(DIST_DIR, "index.html"))) {
        html = fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
      } else {
        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        const selfRes = await fetch(`${proto}://${req.get("host")}/index.html`);
        html = await selfRes.text();
      }

      const e = await db.get(req.params.id);
      if (e) {
        const title = `${e.title} — Weyn`;
        const desc = (e.blurb || `${e.title} in ${e.area}`).slice(0, 200);
        const image = e.image ? `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}${e.image}` : "";
        const url = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}/e/${e.id}`;
        const dateStr = new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        const tags = [
          `<title>${escapeHtml(title)}</title>`,
          `<meta name="description" content="${escapeHtml(desc)}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:title" content="${escapeHtml(title)}" />`,
          `<meta property="og:description" content="${escapeHtml(`${dateStr} · ${e.venue}, ${e.area}`)}" />`,
          `<meta property="og:url" content="${escapeHtml(url)}" />`,
          image && `<meta property="og:image" content="${escapeHtml(image)}" />`,
          `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
          `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
          `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
          image && `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
        ].filter(Boolean).join("\n    ");

        // replace the static <title> and inject the rest before </head> —
        // never string-match on more than the title tag itself, so this
        // can't accidentally corrupt other head content across builds
        html = html.replace(/<title>[^<]*<\/title>/, "").replace("</head>", `    ${tags}\n  </head>`);
      }
      res.set("Content-Type", "text/html").send(html);
    } catch (err) {
      next(err); // fall through to the generic error handler / SPA fallback below
    }
  });

  // ---- serve the built frontend (local Node dev / non-Workers deploys) ----
  // On Vercel this static-file branch is largely a no-op in production
  // (dist/ isn't bundled into the function; Vercel's own static hosting +
  // vercel.json's catch-all rewrite handle every other route directly) but
  // is exactly what `node server/index.js` (local dev) needs.
  if (DIST_DIR && fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, "index.html")));
  }

  return app;
}
