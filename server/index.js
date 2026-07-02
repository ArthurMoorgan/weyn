import "dotenv/config"; // loads .env in the project root (git-ignored) into process.env
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { sendPush, pushConfigured } from "./push.js";
import { scrapeInstagramPost, parseEventFromCaption, downloadImage } from "./instagram-import.js";
import { generateMarketingCopy } from "./marketing.js";
import { refineEventDraft, cleanEventTitle } from "./refine.js";
import { createCheckoutSession, fetchTransactionStatus, verifyIpnSignature, paytabsConfigured } from "./payments.js";
import { attachUser, requireAuth, requireRole, requireEventOwner, issueSessionToken, authConfigured } from "./auth.js";
import { createEventSchema, updateEventSchema, googleAuthSchema, validateBody } from "./validators.js";

// Normalise a user-typed ticket URL so it always redirects OUT of the app.
// A value like "eventbrite.com/x" with no scheme is treated by the browser as a
// relative link (navigating inside the SPA); prefixing https:// fixes that.
function normalizeUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return "https:" + s;
  return "https://" + s.replace(/^\/+/, "");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// same DATA_DIR convention as db.js — point both at a persistent disk in production
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set("trust proxy", 1); // needed behind Render/Fly/Railway's reverse proxy

// CORS: comma-separated allowlist via env. In production this is REQUIRED —
// fail loudly at boot rather than silently falling back to "allow everyone,"
// which is how a wildcard origin ends up shipped by accident.
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && !allowedOrigins.length) {
  throw new Error("CORS_ORIGIN must be set in production — refusing to start with an open CORS policy.");
}
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {})); // unrestricted only in local dev

if (process.env.NODE_ENV === "production" && !authConfigured()) {
  throw new Error("SESSION_SECRET must be set in production — refusing to start without real auth.");
}

// captures the exact raw bytes of the request body — PayTabs' IPN signature
// is an HMAC over the raw payload, which is lost once express.json() parses it
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(attachUser); // sets req.user from a Bearer session token, if present and valid
app.use("/uploads", express.static(UPLOAD_DIR));

// rate limiting — protects routes that cost real money per request (external
// scraping + LLM calls) or that are natural abuse/spam targets
const authLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });
const importLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10, standardHeaders: true, legacyHeaders: false });
const createEventLimiter = rateLimit({ windowMs: 60 * 60e3, max: 20, standardHeaders: true, legacyHeaders: false });

// ---- image upload ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
});

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "event";

// ---- routes ----
app.get("/", (_req, res) => res.json({ name: "weyn-api", ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/events", async (req, res) => {
  let events = [...(await db.all())].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const { cat, q, organizer } = req.query;
  events = events.filter((e) => !e.cancelled); // cancelled events never show in public listings
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

app.get("/api/events/:id", async (req, res) => {
  const e = await db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  db.track("event_view", { userId: req.user?.id, entityId: e.id }).catch(() => {});
  res.json(e);
});

app.post("/api/events", createEventLimiter, requireAuth, upload.single("image"), validateBody(createEventSchema), async (req, res) => {
  try {
    const b = req.body;

    const rawTags = b.tags ? String(b.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
    // Validate & clean the draft before storing. AI pass when configured; the
    // deterministic pass always enforces the title rules (name only, no emoji,
    // no date/time/address). Date/venue/area only backfill EMPTY fields so we
    // never clobber what the organizer explicitly entered.
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
    // BYOT: how attendees actually get in. "weyn" is the only type Weyn tracks capacity/sales for.
    const ticketingType = ["weyn", "external", "cash", "registration"].includes(b.ticketingType) ? b.ticketingType : "weyn";
    // an already-imported/uploaded image (e.g. pulled from Instagram) can be reused without a new file upload
    const existingImage = typeof b.existingImage === "string" && b.existingImage.startsWith("/uploads/") ? b.existingImage : null;

    // Ticket tiers (weyn ticketing only). Sent as a JSON string from the form.
    // When present, price/capacity/sold on the event mirror the tiers so cards,
    // sold-out checks, etc. keep working unchanged.
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
    const ev = {
      id,
      title: refined.title,
      // organizer stays a free-text display name (a brand/venue name, not
      // necessarily the signer's own name) — but ownerId is the real,
      // enforced identity, always the authenticated user, never client-supplied
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
      // when tiers exist, event price = cheapest tier, capacity = sum of tiers
      price: tiers ? Math.min(...tiers.map((t) => t.price)) : Math.max(0, Number(b.price) || 0),
      capacity: tiers ? tiers.reduce((s, t) => s + t.capacity, 0) : Math.max(1, Number(b.capacity) || 50),
      sold: 0,
      tiers,
      image: req.file ? `/uploads/${req.file.filename}` : existingImage,
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
    const inserted = await db.insert(ev);
    res.status(201).json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// the ticket price a booking would actually charge (tier price if tiered, else event price)
function priceFor(e, tierId) {
  if (Array.isArray(e.tiers) && e.tiers.length) {
    const tier = e.tiers.find((t) => t.id === tierId);
    return tier ? tier.price : null;
  }
  return e.price;
}

// book / RSVP — free events only. Paid weyn-ticketed events go through
// POST /api/events/:id/checkout instead (real money, see server/payments.js).
app.post("/api/events/:id/book", async (req, res) => {
  const e = await db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
  if (e.ticketingType && e.ticketingType !== "weyn") {
    return res.status(400).json({ error: "This event isn't ticketed through Weyn — see externalTicketUrl/organizerContact instead" });
  }
  const qty = Math.max(1, Number(req.body?.qty) || 1);
  const price = priceFor(e, req.body?.tierId);
  if (price === null) return res.status(400).json({ error: "Please choose a ticket type" });
  if (price > 0 && paytabsConfigured()) {
    return res.status(400).json({ error: "This is a paid ticket — use POST /api/events/:id/checkout instead" });
  }

  let bookedTier = null;
  if (Array.isArray(e.tiers) && e.tiers.length) {
    // tiered event: must pick a tier, and check/decrement that tier's stock
    const tier = e.tiers.find((t) => t.id === req.body?.tierId);
    if (tier.sold + qty > tier.capacity) return res.status(409).json({ error: `${tier.name} is sold out` });
    const tiers = e.tiers.map((t) => (t.id === tier.id ? { ...t, sold: t.sold + qty } : t));
    await db.update(e.id, { tiers, sold: tiers.reduce((s, t) => s + t.sold, 0) });
    bookedTier = tier.name;
  } else {
    if (e.sold + qty > e.capacity) return res.status(409).json({ error: "Not enough tickets left" });
    await db.update(e.id, { sold: e.sold + qty });
  }

  const deviceId = req.body?.deviceId;
  if (deviceId) {
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;
    await db.addBooking(deviceId, e.id, account, req.body?.tierId);
    const token = await db.tokenForDevice(deviceId);
    if (token) sendPush(token, { title: "You're going! 🎟", body: `${e.title}${bookedTier ? ` (${bookedTier})` : ""} — we'll remind you before it starts.` }).catch(() => {});
  }
  res.json(await db.get(e.id));
});

// ---- paid checkout (PayTabs) ----
// Creates a pending Booking + a hosted PayTabs checkout page, returns the
// redirect URL. The booking only flips to "paid" once the IPN webhook (or the
// success-page poll, see GET /api/bookings/:id) confirms real payment.
// PayTabs uses a single return_url (no separate cancel_url) — the returned
// page polls booking status regardless of how the buyer got there.
app.post("/api/events/:id/checkout", async (req, res) => {
  if (!paytabsConfigured()) return res.status(503).json({ error: "Payments aren't configured on this server yet" });
  const e = await db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
  if (e.ticketingType !== "weyn") {
    return res.status(400).json({ error: "This event isn't ticketed through Weyn" });
  }
  const qty = Math.max(1, Number(req.body?.qty) || 1);
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
      successUrl: `${origin}/#/checkout/success?booking=${booking.id}`,
      callbackUrl: `${origin}/api/payments/webhook`,
      customerIp: req.ip,
    });
    await db.prisma.payment.create({
      data: { bookingId: booking.id, paytabsTranRef: tranRef, amount: price * qty },
    });
    res.json({ checkoutUrl, bookingId: booking.id });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// PayTabs calls this on payment success/failure — verified with the HMAC
// "Signature" header (see server/payments.js) before it's trusted at all.
app.post("/api/payments/webhook", async (req, res) => {
  const signature = req.header("Signature") || req.header("signature");
  if (!verifyIpnSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: "Invalid IPN signature" });
  }
  const tranRef = req.body?.tran_ref;
  if (!tranRef) return res.status(400).json({ error: "No tran_ref in webhook payload" });
  const payment = await db.prisma.payment.findUnique({ where: { paytabsTranRef: tranRef }, include: { booking: true } });
  if (!payment) return res.status(404).json({ error: "Unknown transaction" });
  try {
    await confirmPaymentFromPayTabs(payment, req.body);
  } catch (err) {
    console.error("[weyn] webhook confirm failed:", err.message);
  }
  res.json({ ok: true });
});

// Re-queries the transaction status directly from PayTabs (defense in depth
// beyond the already-verified signature) and, only on genuine success, marks
// the booking paid + decrements stock inside a transaction (so two
// simultaneous confirmations for the last unit of stock can't double-book).
async function confirmPaymentFromPayTabs(payment, rawWebhook) {
  if (payment.status === "paid") return; // already confirmed, avoid double-decrementing stock
  const { success, raw } = await fetchTransactionStatus(payment.paytabsTranRef);
  await db.prisma.payment.update({ where: { id: payment.id }, data: { rawWebhook: rawWebhook || raw, status: success ? "paid" : "failed" } });
  if (!success) return;

  await db.prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking || booking.status === "paid") return;
    if (booking.tierId) {
      const tier = await tx.tier.findUnique({ where: { id: booking.tierId } });
      if (tier.sold + booking.qty > tier.capacity) throw new Error("Sold out during payment confirmation");
      await tx.tier.update({ where: { id: tier.id }, data: { sold: tier.sold + booking.qty } });
      await tx.event.update({ where: { id: booking.eventId }, data: { sold: { increment: booking.qty } } });
    } else {
      const event = await tx.event.findUnique({ where: { id: booking.eventId } });
      if (event.sold + booking.qty > event.capacity) throw new Error("Sold out during payment confirmation");
      await tx.event.update({ where: { id: booking.eventId }, data: { sold: { increment: booking.qty } } });
    }
    await tx.booking.update({ where: { id: booking.id }, data: { status: "paid" } });
  });

  const updated = await db.prisma.booking.findUnique({ where: { id: payment.bookingId } });
  if (updated?.deviceId) {
    const token = await db.tokenForDevice(updated.deviceId);
    if (token) {
      const e = await db.get(updated.eventId);
      sendPush(token, { title: "You're going! 🎟", body: `${e?.title || "Your ticket"} is confirmed — we'll remind you before it starts.` }).catch(() => {});
    }
  }
}

// Success page polls this — the webhook (or this poll re-checking PayTabs
// directly, as a fallback if the webhook never arrives) is the source of
// truth, not the browser redirect.
app.get("/api/bookings/:id", async (req, res) => {
  const booking = await db.getBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.status === "pending" && booking.payment?.paytabsTranRef) {
    try { await confirmPaymentFromPayTabs(booking.payment, null); } catch { /* keep pending, client will poll again */ }
  }
  const fresh = await db.getBooking(req.params.id);
  res.json({ id: fresh.id, status: fresh.status, eventId: fresh.eventId, eventTitle: fresh.event?.title || null });
});

// ---- organizer event management ----
// Every route below mutates or reveals data tied to a specific event, so all
// of them require the caller to actually own that event (or be an ADMIN) —
// see server/auth.js's requireEventOwner. Before this, none of them checked
// who was calling at all.
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
  res.json(await db.update(e.id, patch));
});

app.post("/api/events/:id/cancel", requireEventOwner(), async (req, res) => {
  res.json(await db.update(req.event.id, { cancelled: true }));
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

// Attendee names/emails are PII — this used to be a public, unauthenticated
// route. Now only the event's owner (or an ADMIN) can read it.
app.get("/api/events/:id/attendees", requireEventOwner(), async (req, res) => {
  res.json(await db.attendeesForEvent(req.event.id));
});

// ---- moderation (ADMIN only) ----
// Minimal, deliberately crude per the audit's recommendation: no admin UI
// yet, just a real, enforced route an admin can call (curl/Postman) to pull
// down a bad-faith event immediately, without editing the database by hand.
// ADMIN is never self-assigned — grant it by hand via `npx prisma studio`
// (or a one-off script) on a trusted User row.
app.post("/api/admin/events/:id/moderate", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const e = await db.get(req.params.id);
  if (!e) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
  const action = req.body?.action;
  if (action === "cancel") return res.json(await db.update(e.id, { cancelled: true }));
  if (action === "remove") { await db.remove(e.id); return res.json({ ok: true }); }
  res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be 'cancel' or 'remove'" } });
});

// ---- Google Sign-In ----
// Verifies the ID token with Google's tokeninfo endpoint (no extra JWT library
// needed for THAT part). If GOOGLE_CLIENT_ID is set, also checks the token
// was issued for this app specifically. On success, upserts a real User row
// and issues a Weyn session token — this is what every requireAuth route
// below actually checks, not just "a Google token was once shown to us."
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
    if (authConfigured()) {
      const user = await db.upsertUserFromGoogle({ googleSub: info.sub, email: info.email, name: account.name, avatarUrl: account.picture });
      sessionToken = issueSessionToken(user);
    }
    res.json({ ...account, sessionToken });
  } catch {
    res.status(502).json({ error: "Couldn't verify token with Google" });
  }
});

// ---- push notifications ----
app.get("/api/push/status", (_req, res) => res.json({ configured: pushConfigured() }));

app.post("/api/push/register", async (req, res) => {
  const { deviceId, token, platform } = req.body || {};
  if (!deviceId || !token) return res.status(400).json({ error: "deviceId and token are required" });
  await db.upsertPushToken(deviceId, token, platform || "ios");
  res.json({ ok: true });
});

// dev helper: manually fire a push to a registered device to confirm the pipeline end-to-end
app.post("/api/push/test", async (req, res) => {
  const { deviceId } = req.body || {};
  const token = deviceId && (await db.tokenForDevice(deviceId));
  if (!token) return res.status(404).json({ error: "No push token registered for that deviceId" });
  const result = await sendPush(token, { title: "Weyn", body: "Test notification — if you see this, push works! 🎉" });
  res.json(result);
});

// reminder scanner — every 5 min, notify devices whose booked event starts in ~2h
const REMIND_LEAD_MS = 2 * 3600e3;
const SCAN_EVERY_MS = 5 * 60e3;
// stale-checkout cleanup — abandoned pending bookings older than 30min don't
// count against capacity forever (see server/payments.js and the checkout route)
const PENDING_TTL_MS = 30 * 60e3;
setInterval(async () => {
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
}, SCAN_EVERY_MS).unref();

// organizer dashboard summary
app.get("/api/organizer/:name/summary", async (req, res) => {
  const mine = (await db.all()).filter((e) => e.organizer === req.params.name);
  const grossRevenue = mine.reduce((s, e) => s + e.sold * e.price, 0);
  const netRevenue = +(grossRevenue * 0.92).toFixed(2);
  const ticketsSold = mine.reduce((s, e) => s + e.sold, 0);
  res.json({
    events: mine.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
    stats: {
      eventCount: mine.length,
      ticketsSold,
      grossRevenue: +grossRevenue.toFixed(2),
      netRevenue,
      feePaid: +(grossRevenue * 0.08).toFixed(2),
    },
  });
});

// ---- Feature 1: Auto-Generate Event Pages From Instagram ----
// Costs a real external fetch + (optionally) an LLM call per request, and is
// part of the hosting flow — rate-limited and auth-gated so it can't be used
// as a free scraping/LLM proxy by an anonymous caller.
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
    if (imageUrl) imagePath = await downloadImage(imageUrl, UPLOAD_DIR);

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

// ---- Feature 2: Create Once, Publish Everywhere ----
// Organizer-only tooling, same ownership gate as the rest of this section.
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

// multer/upload errors
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Upload failed" });
});

// ---- serve the built frontend (single-deployment mode) ----
// If dist/ exists (produced by `npm run build`), serve it and fall back to
// index.html for any non-API route so client-side routing (HashRouter) works
// on a hard refresh. Local dev doesn't need this — Vite serves the frontend
// itself on :5173 — this only matters for a deployed, single-process setup
// (e.g. Fly) where one Express process serves both API and static assets.
const DIST_DIR = path.join(__dirname, "..", "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, "index.html")));
}

// hosts like Render/Fly/Railway inject PORT; local dev keeps using API_PORT/4000
const PORT = process.env.PORT || process.env.API_PORT || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`[weyn] API listening on port ${PORT}`));
