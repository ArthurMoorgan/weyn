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
import { scrapeInstagramPost, parseEventFromCaption, downloadImage } from "./instagram-import.js";
import { generateMarketingCopy } from "./marketing.js";
import { refineEventDraft, cleanEventTitle } from "./refine.js";
import { suggestImageFocalPoint } from "./ai.js";
import { createCheckoutSession, fetchTransactionStatus, verifyIpnSignature, paytabsConfigured } from "./payments.js";
import { attachUser, requireAuth, requireRole, requireEventOwner, requireEventOwnerStrict, requireEventAccess, issueSessionToken, authConfigured } from "./auth.js";
import { createEventSchema, updateEventSchema, googleAuthSchema, validateBody } from "./validators.js";
import { initSentry, initPostHog, captureError, trackEvent, Sentry, sentryReady } from "./monitoring.js";
import { sniffImageMime, EXT_BY_MIME } from "./image-utils.js";
import { sendEmail, emailConfigured, teamInviteEmail } from "./email.js";
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

  // security headers (HSTS, X-Content-Type-Options, disabled X-Powered-By,
  // frame-ancestors via CSP, etc). Every directive below maps to a specific
  // external resource this app actually loads (see index.html and
  // src/google-maps.ts / GoogleLoginButton.tsx) — no wildcards, so a new
  // third-party script/host added later will need an explicit addition here
  // rather than silently working.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // event covers are proxied through our own /uploads/:key route
        // (storage.readImage), never linked to R2/Blob directly — 'self'
        // covers them. data: for the inline SVG favicon, googleusercontent
        // for Google account profile pictures.
        imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
        scriptSrc: ["'self'", "https://accounts.google.com/gsi/client", "https://maps.googleapis.com"],
        // Vite/React inject some inline <style> at runtime; Google Fonts'
        // stylesheet is itself hosted on fonts.googleapis.com
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'", "https://accounts.google.com", "https://maps.googleapis.com", "https://nominatim.openstreetmap.org"],
        frameSrc: ["https://accounts.google.com"], // Google Sign-In's One Tap / button iframe
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
    throw new Error("SESSION_SECRET must be set in production — refusing to start without real auth.");
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
    events = events.filter((e) => !e.cancelled && e.discoveryStatus === "APPROVED");
    if (cat && cat !== "all") events = events.filter((e) => e.cat === cat);
    if (organizer) events = events.filter((e) => e.organizer === organizer);
    if (q) {
      const t = String(q).toLowerCase();
      events = events.filter((e) =>
        (e.title + e.organizer + e.area + e.venue + (e.tags || []).join(" ")).toLowerCase().includes(t)
      );
      db.track("search", { userId: req.user?.id, metadata: { query: q, resultCount: events.length } }).catch(() => {});
    }
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
    res.json(e);
  });

  app.post("/api/events", createEventLimiter, requireAuth, upload.single("image"), validateBody(createEventSchema), async (req, res) => {
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
      const ticketingType = ["weyn", "external", "cash", "registration"].includes(b.ticketingType) ? b.ticketingType : "weyn";
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

      let image = existingImage;
      if (req.file) {
        const realMime = sniffImageMime(req.file.buffer);
        if (!realMime) return res.status(400).json({ error: "That file doesn't look like a valid PNG/JPEG/WEBP/GIF" });
        const ext = EXT_BY_MIME[realMime];
        ({ url: image } = await storage.saveImage(req.file.buffer, ext));
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
    trackEvent(req.user?.id || deviceId, "booking_completed", { eventId: e.id, qty, tierId, free: true });
    res.json({ ...(await db.get(e.id)), bookingId: booking.id });
  });

  app.post("/api/events/:id/checkout", bookingLimiter, async (req, res) => {
    if (!paytabsConfigured()) return res.status(503).json({ error: "Payments aren't configured on this server yet" });
    const e = await db.get(req.params.id);
    if (!e) return res.status(404).json({ error: "Event not found" });
    if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
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

    const origin = req.body?.origin || `${req.protocol}://${req.get("host")}`;
    try {
      const { tranRef, checkoutUrl } = await createCheckoutSession({
        booking,
        event: e,
        tier,
        successUrl: `${origin}/checkout/success?booking=${booking.id}`,
        callbackUrl: `${origin}/api/payments/webhook`,
        customerIp: req.ip,
      });
      await prisma.payment.create({
        data: { bookingId: booking.id, paytabsTranRef: tranRef, amount: price * qty },
      });
      trackEvent(req.user?.id || deviceId, "checkout_started", { eventId: e.id, qty, tierId, amount: price * qty });
      res.json({ checkoutUrl, bookingId: booking.id });
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

    if (booking.deviceId) {
      const token = await db.tokenForDevice(booking.deviceId);
      if (token) {
        const e = await db.get(booking.eventId);
        sendPush(token, { title: "You're going! 🎟", body: `${e?.title || "Your ticket"} is confirmed — we'll remind you before it starts.` }).catch(() => {});
      }
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
      else if (key === "ticketingType") patch.ticketingType = ["weyn", "external", "cash", "registration"].includes(req.body.ticketingType) ? req.body.ticketingType : e.ticketingType;
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
    res.json(await db.eventAnalytics(req.event.id));
  });

  // ---- team management (see schema.prisma's EventTeamMember comment) ----
  // Invite/revoke are owner-only (requireEventOwnerStrict) — a MANAGER runs
  // the event day-to-day but can't grant or remove other people's access.
  app.post("/api/events/:id/team/invite", requireEventOwnerStrict(), async (req, res) => {
    const { email, role } = req.body || {};
    if (!email || !["MANAGER", "STAFF"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "email and role (MANAGER or STAFF) are required" } });
    }
    const invite = await db.createTeamInvite({ eventId: req.event.id, invitedEmail: email, role, invitedBy: req.user.id });
    await db.audit("event.team.invite", { actorId: req.user.id, entityType: "event", entityId: req.event.id, metadata: { email, role } });
    const origin = req.body?.origin || `${req.protocol}://${req.get("host")}`;
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

  // Accepting requires being signed in — the invite is scoped to whatever
  // email it was sent to, but Weyn has no verified-email-ownership step
  // today (same trust level as everything else gated on Google Sign-In
  // identity), so this just requires *a* session, not a matching email.
  app.post("/api/team/invites/:token/accept", requireAuth, async (req, res) => {
    const invite = await db.getInviteByToken(req.params.token);
    if (!invite || invite.status !== "PENDING") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "This invite link is invalid or already used" } });
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
    const c = await db.getCollection(req.params.id);
    if (!c || (!c.isPublic && c.ownerId !== req.user?.id)) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Collection not found" } });
    }
    res.json(c);
  });

  app.patch("/api/collections/:id", requireAuth, loadOwnedCollection, async (req, res) => {
    const { name, isPublic } = req.body || {};
    if (name !== undefined) await db.renameCollection(req.params.id, name);
    if (isPublic !== undefined) await prisma.collection.update({ where: { id: req.params.id }, data: { isPublic: !!isPublic } });
    res.json(await db.getCollection(req.params.id));
  });

  app.delete("/api/collections/:id", requireAuth, loadOwnedCollection, async (req, res) => {
    await db.deleteCollection(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/collections/:id/items", requireAuth, loadOwnedCollection, async (req, res) => {
    const { eventId } = req.body || {};
    if (!eventId) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "eventId is required" } });
    await db.addToCollection(req.params.id, eventId);
    res.status(201).json(await db.getCollection(req.params.id));
  });

  app.delete("/api/collections/:id/items/:eventId", requireAuth, loadOwnedCollection, async (req, res) => {
    await db.removeFromCollection(req.params.id, req.params.eventId);
    res.json(await db.getCollection(req.params.id));
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

  app.post("/api/auth/google", authLimiter, validateBody(googleAuthSchema), async (req, res) => {
    const { idToken } = req.body;
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!r.ok) return res.status(401).json({ error: "Invalid Google token" });
      const info = await r.json();
      if (process.env.GOOGLE_CLIENT_ID && info.aud !== process.env.GOOGLE_CLIENT_ID) {
        return res.status(401).json({ error: "Token was not issued for this app" });
      }
      const account = { email: info.email, name: info.name || info.email, picture: info.picture || null };
      let sessionToken = null;
      let role;
      if (authConfigured()) {
        const user = await db.upsertUserFromGoogle({ googleSub: info.sub, email: info.email, name: account.name, avatarUrl: account.picture });
        sessionToken = issueSessionToken(user);
        role = user.role;
      }
      res.json({ ...account, sessionToken, role });
    } catch {
      res.status(502).json({ error: "Couldn't verify token with Google" });
    }
  });

  app.get("/api/push/status", (_req, res) => res.json({ configured: pushConfigured() }));

  app.post("/api/push/register", async (req, res) => {
    const { deviceId, token, platform } = req.body || {};
    if (!deviceId || !token) return res.status(400).json({ error: "deviceId and token are required" });
    await db.upsertPushToken(deviceId, token, platform || "ios");
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

  app.post("/api/events/:id/marketing/regenerate", requireEventOwner(), async (req, res) => {
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
