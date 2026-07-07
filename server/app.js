// The actual Express app — every route lives here. Shared between two entry
// points: server/index.js (plain Node, local dev) and server/worker.js
// (Cloudflare Workers, production). Neither entry point's runtime-specific
// imports (dotenv, cloudflare:node, cloudflare:workers) belong in this file —
// `storage` (disk vs R2) is injected by whichever entry constructs the app,
// so this file never needs to know which runtime it's on.
import express from "express";
import helmet from "helmet";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { db, prisma } from "./db.js";
import { sendPush, pushConfigured } from "./push.js";
import { sendWebPush, webPushConfigured } from "./webpush.js";
import { scrapeInstagramPost, parseEventFromCaption, downloadImage } from "./instagram-import.js";
import { generateMarketingCopy } from "./marketing.js";
import { refineEventDraft, cleanEventTitle } from "./refine.js";
import { suggestImageFocalPoint } from "./ai.js";
import { createCheckoutSession, fetchTransactionStatus, verifyIpnSignature, paytabsConfigured } from "./payments.js";
import { attachUser, requireAuth, requireRole, requireEventOwner, requireEventOwnerStrict, requireEventAccess, authConfigured } from "./auth.js";
import { createEventSchema, updateEventSchema, validateBody } from "./validators.js";
import { initSentry, initPostHog, captureError, trackEvent, Sentry, sentryReady } from "./monitoring.js";
import { FEATURES, hasFeature, allFeatures, ensureSubscription, requireFeature } from "./features.js";
import { sniffImageMime, EXT_BY_MIME } from "./image-utils.js";
import { sendEmail, emailConfigured, teamInviteEmail, bookingConfirmationEmail } from "./email.js";
import { runModerationPipeline } from "./moderation.js";

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

// Fan out a push to every device a user has registered — web (VAPID,
// browsers/PWA) and native (APNs), best-effort per-device so one bad
// subscription never blocks the others. Used wherever a server-side event
// (e.g. venue approval) needs to reach a *person* rather than the one
// deviceId a specific booking happened to be made from.
async function notifyUser(userId, { title, body, data, url } = {}) {
  if (!userId) return { sent: 0 };
  let sent = 0;
  const [webSubs, nativeTokens] = await Promise.all([
    prisma.webPushSubscription.findMany({ where: { userId } }),
    db.tokensForUser(userId),
  ]);
  await Promise.all(webSubs.map(async (sub) => {
    const result = await sendWebPush(sub, { title, body, data, url });
    if (result.sent) sent++;
    // The browser revoked/expired this subscription — stop retrying it.
    else if (result.expired) await prisma.webPushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
  }));
  await Promise.all(nativeTokens.map(async (token) => {
    const result = await sendPush(token, { title, body, data });
    if (result.sent) sent++;
  }));
  return { sent };
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
    const token = await db.tokenForDevice(b.deviceId);
    const e = await db.get(b.eventId);
    if (token && e) {
      await sendPush(token, { title: "Starting soon ⏰", body: `${e.title} starts in about 2 hours at ${e.venue}.` });
    }
    await db.markReminded(b.deviceId, b.eventId);
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
        // Clerk ships its own JS bundle via npm (@clerk/react) — no external
        // <script> host needed for auth itself, only Maps stays external.
        scriptSrc: ["'self'", "https://maps.googleapis.com"],
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
        connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://clerk.weynevents.com", "https://maps.googleapis.com", "https://nominatim.openstreetmap.org", "https://us.i.posthog.com", "https://eu.i.posthog.com"],
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
  // no-op. waitlist.weynevents.com is exempt — that domain is the
  // intentionally-public surface while this is active.
  const adminAllowlist = (process.env.ADMIN_ALLOWLIST_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (adminAllowlist.length) {
    app.use((req, res, next) => {
      if (req.hostname === "waitlist.weynevents.com") return next();
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
    events = events.filter((e) => !e.cancelled && e.discoveryStatus === "APPROVED" && !e.inviteOnly && !isOver(e));
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
    db.track("event_view", { userId: req.user?.id, entityId: e.id }).catch(() => {});
    res.set('Cache-Control', e.inviteOnly ? 'private, no-store' : 'no-store');
    // Invite-only events are reachable by direct link (title/date/venue all
    // still show — the recipient needs to see what they're being invited
    // to), but the actual secret code is never sent to anyone except the
    // owner. The frontend already has it from the URL (?invite=CODE) if
    // it's unlocking the buy bar, so it never needs it echoed back here.
    const { inviteCode, ...safe } = e;
    res.json(isOwner ? e : safe);
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
      const ALLOWED_TICKETING = ["external", "cash", "registration"];
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
        // best-guess focal point (Groq vision) so the same photo crops sensibly
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
        sourceUrl: b.sourceUrl || null,
        importedFromInstagram: b.importedFromInstagram === "true" || b.importedFromInstagram === true,
      };

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

    let bookedTier = null;
    const tierId = req.body?.tierId || null;
    if (Array.isArray(e.tiers) && e.tiers.length) {
      const tier = e.tiers.find((t) => t.id === tierId);
      if (!tier) return res.status(400).json({ error: "Please choose a ticket type" });
      // atomic claim — see db.claimTierCapacity's comment for why this can't
      // be a plain read-then-write without risking overselling under load
      const claimed = await db.claimTierCapacity(tier.id, qty);
      if (!claimed) return res.status(409).json({ error: `${tier.name} is sold out` });
      await prisma.event.update({ where: { id: e.id }, data: { sold: { increment: qty } } });
      bookedTier = tier.name;
    } else {
      const claimed = await db.claimEventCapacity(e.id, qty);
      if (!claimed) return res.status(409).json({ error: "Not enough tickets left" });
    }

    const deviceId = req.body?.deviceId;
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;
    const booking = await db.createPendingBooking({ eventId: e.id, tierId, deviceId, account, qty });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "paid" } });
    await db.issueTickets(booking.id, e.id, qty);
    if (deviceId) {
      const token = await db.tokenForDevice(deviceId);
      if (token) sendPush(token, { title: "You're going! 🎟", body: `${e.title}${bookedTier ? ` (${bookedTier})` : ""} — we'll remind you before it starts.` }).catch(() => {});
    }
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
    const price = priceFor(e, tierId);
    if (price === null) return res.status(400).json({ error: "Please choose a ticket type" });
    if (price <= 0) return res.status(400).json({ error: "This ticket is free — use POST /api/events/:id/book instead" });

    const tier = tierId ? e.tiers.find((t) => t.id === tierId) : null;
    const remaining = tier ? tier.capacity - tier.sold : e.capacity - e.sold;
    if (qty > remaining) return res.status(409).json({ error: tier ? `${tier.name} is sold out` : "Not enough tickets left" });

    const deviceId = req.body?.deviceId;
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;
    const booking = await db.createPendingBooking({ eventId: e.id, tierId, deviceId, account, qty });

    const origin = publicOrigin(req);
    try {
      const { tranRef, checkoutUrl } = await createCheckoutSession({
        booking,
        event: e,
        tier,
        successUrl: `${origin}/checkout/success?booking=${booking.id}&accessToken=${booking.accessToken}`,
        callbackUrl: `${origin}/api/payments/webhook`,
        customerIp: req.ip,
      });
      await prisma.payment.create({
        data: { bookingId: booking.id, paytabsTranRef: tranRef, amount: price * qty },
      });
      trackEvent(req.user?.id || deviceId, "checkout_started", { eventId: e.id, qty, tierId, amount: price * qty });
      res.json({ checkoutUrl, bookingId: booking.id, accessToken: booking.accessToken });
    } catch (err) {
      captureError(err, { route: "POST /api/events/:id/checkout", eventId: e.id });
      res.status(502).json({ error: err.message });
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
    trackEvent(booking.deviceId || "unknown", "checkout_completed", { eventId: booking.eventId, qty: booking.qty });

    const e = await db.get(booking.eventId);
    if (booking.deviceId) {
      const token = await db.tokenForDevice(booking.deviceId);
      if (token) {
        sendPush(token, { title: "You're going! 🎟", body: `${e?.title || "Your ticket"} is confirmed — we'll remind you before it starts.` }).catch(() => {});
      }
    }
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
    const booking = await db.getBooking(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.accessToken && req.query.accessToken !== booking.accessToken) {
      return res.status(403).json({ error: "Ticket access token is required" });
    }
    const tickets = await db.ticketsForBooking(req.params.id);
    res.json(tickets.map((t) => ({ code: t.code, checkedInAt: t.checkedInAt })));
  });

  // Door check-in — only the event's owner/staff (or an ADMIN) can scan
  // tickets for it, and the underlying UPDATE is conditional on
  // checkedInAt still being null, so a code can never admit twice even if
  // two staff scan it at the same instant (see db.checkInTicket).
  app.post("/api/tickets/:code/checkin", checkinLimiter, requireAuth, async (req, res) => {
    const ticket = await db.getTicketByCode(req.params.code);
    if (!ticket) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown ticket code" } });
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
      return res.status(409).json({ error: { code: "ALREADY_USED", message: `Already checked in at ${ticket.checkedInAt.toISOString()}` } });
    }
    const result = await db.checkInTicket(req.params.code, req.user.id);
    if (!result) {
      return res.status(409).json({ error: { code: "ALREADY_USED", message: "This ticket was just checked in by someone else" } });
    }
    await db.audit("ticket.checkin", { actorId: req.user.id, entityType: "ticket", entityId: ticket.id, metadata: { eventId: ticket.eventId, bookingId: ticket.bookingId } });
    trackEvent(req.user.id, "ticket_checkin", { eventId: ticket.eventId });
    res.json({ ok: true, checkedInAt: result.checkedInAt });
  });

  const EDITABLE_FIELDS = ["title", "blurb", "price", "capacity", "startsAt", "refundPolicy", "venue", "area", "minAge", "tags", "ticketingType", "externalTicketUrl", "organizerContact"];
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
      else if (key === "ticketingType") patch.ticketingType = ["external", "cash", "registration"].includes(req.body.ticketingType) ? req.body.ticketingType : e.ticketingType;
      else if (key === "externalTicketUrl") patch.externalTicketUrl = normalizeUrl(req.body.externalTicketUrl);
      else if (key === "title") patch.title = cleanEventTitle(req.body.title) || e.title;
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

  app.get("/api/events/:id/attendees", requireEventOwner(), async (req, res) => {
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
    const { eventId, code } = req.body || {};
    if (!eventId || !code) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "eventId and code are required" } });
    const promo = await prisma.promoCode.findUnique({ where: { eventId_code: { eventId, code: String(code).trim().toUpperCase() } } });
    if (!promo || !promo.active) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invalid promo code" } });
    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) return res.status(400).json({ error: { code: "NOT_STARTED", message: "This code isn't active yet" } });
    if (promo.endsAt && promo.endsAt < now) return res.status(400).json({ error: { code: "EXPIRED", message: "This code has expired" } });
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return res.status(400).json({ error: { code: "EXHAUSTED", message: "This code has reached its usage limit" } });
    res.json({ code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue });
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
      res.status(201).json({ id: entry.id });
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "You're already on the waitlist for this event" } });
      throw err;
    }
  });
  app.get("/api/events/:id/waitlist", requireEventOwner(), requireFeature("waitlists"), async (req, res) => {
    res.json(await prisma.waitlistEntry.findMany({ where: { eventId: req.event.id }, orderBy: { createdAt: "asc" } }));
  });

  // ---- Marketing: bulk notify attendees (send-now; true scheduled/future-
  // dated sends aren't built yet, see handoff.md) ----
  app.post("/api/events/:id/notify", socialLimiter, requireEventOwner(), requireFeature("bulkNotifications"), async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!subject || !message) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject and message are required" } });
    const bookings = await prisma.booking.findMany({ where: { eventId: req.event.id, status: "paid" }, select: { email: true, deviceId: true } });
    let emailed = 0;
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    const safeTitle = escapeHtml(req.event.title);
    await Promise.all(bookings.filter((b) => b.email).map((b) =>
      sendEmail({
        to: b.email,
        subject: `${req.event.title}: ${subject}`,
        html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you have a ticket to ${safeTitle}.</p></div>`,
      }).then(() => emailed++).catch((err) => captureError(err, { route: "POST /api/events/:id/notify", eventId: req.event.id }))
    ));
    const deviceIds = [...new Set(bookings.filter((b) => b.deviceId).map((b) => b.deviceId))];
    let pushed = 0;
    await Promise.all(deviceIds.map(async (deviceId) => {
      const token = await db.tokenForDevice(deviceId);
      if (!token) return;
      const result = await sendPush(token, { title: req.event.title, body: subject });
      if (result.sent) pushed++;
    }));
    await db.audit("event.notify", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { subject, emailed, pushed } });
    res.json({ ok: true, recipients: bookings.length, emailed, pushed });
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
      trackEvent(req.user?.id || guestEmail, "reservation_created", { venueId: venue.id, partySize: size });
      res.status(201).json(reservation);
    } catch (err) {
      captureError(err, { route: "POST /api/venues/:id/reservations", venueId: req.params.id });
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
      const notifyTo = process.env.VENUE_APPLICATION_NOTIFY_EMAIL || "dhairyarsaluja@gmail.com";
      sendEmail({
        to: notifyTo,
        subject: `New venue application: ${application.name}`,
        html: `
          <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 12px">New reservation-hosting application</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#222">
              <tr><td style="padding:6px 0;color:#888">Venue</td><td style="padding:6px 0"><b>${application.name}</b></td></tr>
              <tr><td style="padding:6px 0;color:#888">Type</td><td style="padding:6px 0">${application.businessType}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Area</td><td style="padding:6px 0">${application.area || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Contact</td><td style="padding:6px 0">${application.contactName} (${application.role})</td></tr>
              <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${application.contactEmail}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${application.contactPhone || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Address</td><td style="padding:6px 0">${application.venue || "—"}${application.area ? ", " + application.area : ""}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Reg. no.</td><td style="padding:6px 0">${application.businessRegNo || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Price range</td><td style="padding:6px 0">${application.priceRange || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#888;vertical-align:top">Description</td><td style="padding:6px 0">${application.description || "—"}</td></tr>
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
        include: { slot: true },
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

  // Owner confirms or cancels a reservation for their venue.
  app.post("/api/reservations/:id/status", requireAuth, async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      if (!["confirmed", "cancelled"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be 'confirmed' or 'cancelled'" } });
      }
      const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { venue: true } });
      if (!reservation) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Reservation not found" } });
      if (reservation.venue.ownerId !== req.user.id && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't manage this venue" } });
      }
      const updated = await prisma.reservation.update({ where: { id: reservation.id }, data: { status } });
      res.json(updated);
    } catch (err) {
      captureError(err, { route: "POST /api/reservations/:id/status", reservationId: req.params.id });
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

  app.get("/api/events/:id/analytics", requireEventAccess("MANAGER"), async (req, res) => {
    // Gated on the EVENT OWNER's plan, not the viewer's — a team member
    // with MANAGER access should see the same advanced stats the owner
    // would, not a downgraded view based on their own personal account.
    const advanced = !!(req.event.ownerId && (await hasFeature(req.event.ownerId, "advancedAnalytics")));
    res.json(await db.eventAnalytics(req.event.id, { advanced }));
  });

  // ---- team management (see schema.prisma's EventTeamMember comment) ----
  // Invite/revoke are owner-only (requireEventOwnerStrict) — a MANAGER runs
  // the event day-to-day but can't grant or remove other people's access.
  app.post("/api/events/:id/team/invite", teamInviteLimiter, requireEventOwnerStrict(), async (req, res) => {
    const { email, role } = req.body || {};
    if (!email || !["MANAGER", "STAFF"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "email and role (MANAGER or STAFF) are required" } });
    }
    const invite = await db.createTeamInvite({ eventId: req.event.id, invitedEmail: email, role, invitedBy: req.user.id });
    await db.audit("event.team.invite", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { email, role } });
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
      id: m.id, email: m.invitedEmail, role: m.role, status: m.status,
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
    try {
      await prisma.landingWaitlistSignup.upsert({
        where: { email: trimmedEmail },
        create: { email: trimmedEmail, name: name ? String(name).trim().slice(0, 120) : null, role: role ? String(role).slice(0, 40) : null, source: source ? String(source).slice(0, 120) : null },
        update: {},
      });
      trackEvent(null, "landing_waitlist_joined", { role: role || null, source: source || null });
      res.status(201).json({ ok: true });
    } catch (err) {
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
        features,
        paymentHistory,
      });
    } catch (err) {
      captureError(err, { route: "GET /api/me/subscription", userId: req.user.id });
      res.status(500).json({ error: "Couldn't load subscription info" });
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

  app.get("/api/push/status", (_req, res) => res.json({ configured: pushConfigured() }));

  app.post("/api/push/register", async (req, res) => {
    const { deviceId, token, platform, deviceSecret } = req.body || {};
    if (!deviceId || !token || !deviceSecret) return res.status(400).json({ error: "deviceId, token, and deviceSecret are required" });
    if (!/^[0-9a-f-]{20,}$/i.test(deviceId) || String(deviceSecret).length < 32 || String(token).length < 20) {
      return res.status(400).json({ error: "Invalid push registration payload" });
    }
    try {
      await db.upsertPushToken(deviceId, token, ["ios", "android"].includes(platform) ? platform : "ios", deviceSecret, req.user?.id || null);
      res.json({ ok: true });
    } catch {
      res.status(403).json({ error: "Invalid device secret" });
    }
  });

  // Web Push (VAPID) — browser/PWA notifications. Keyed by userId (unlike
  // PushToken's deviceId), so this is what lets a server-side event like
  // "your venue application was approved" reach a specific person's devices
  // without needing a deviceId collected earlier in an unrelated flow.
  app.get("/api/push/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  });
  app.post("/api/push/web-subscribe", requireAuth, async (req, res) => {
    const { endpoint, keys } = req.body?.subscription || req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "A valid PushSubscription (endpoint + keys.p256dh + keys.auth) is required" });
    }
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
    });
    res.json({ ok: true });
  });
  app.post("/api/push/web-unsubscribe", requireAuth, async (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "endpoint is required" });
    await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
    res.json({ ok: true });
  });

  // ADMIN-only: this fires a real push to any registered device, so leaving
  // it open let anyone spam notifications to a device they named. It's a
  // debugging tool, not a user-facing endpoint.
  app.post("/api/push/test", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const { deviceId } = req.body || {};
    const token = deviceId && (await db.tokenForDevice(deviceId));
    if (!token) return res.status(404).json({ error: "No push token registered for that deviceId" });
    const result = await sendPush(token, { title: "Weyn", body: "Test notification — if you see this, push works! 🎉" });
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
      copy = await generateMarketingCopy(e);
      await db.setMarketing(e.id, copy);
    }
    res.json(copy);
  });

  // importLimiter (shared LLM-cost bucket): regenerate makes a paid model
  // call, so cap it even though it's owner-gated — stops an owner from
  // hammering it to run up API cost.
  app.post("/api/events/:id/marketing/regenerate", importLimiter, requireEventOwner(), async (req, res) => {
    const copy = await generateMarketingCopy(req.event);
    await db.setMarketing(req.event.id, copy);
    res.json(copy);
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
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
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
