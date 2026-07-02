import "dotenv/config"; // loads .env in the project root (git-ignored) into process.env
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { sendPush, pushConfigured } from "./push.js";
import { scrapeInstagramPost, parseEventFromCaption, downloadImage } from "./instagram-import.js";
import { generateMarketingCopy } from "./marketing.js";
import { refineEventDraft, cleanEventTitle } from "./refine.js";

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

// CORS: comma-separated allowlist via env in production; open by default for local dev
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

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

app.get("/api/events", (req, res) => {
  let events = [...db.all()].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const { cat, q, organizer } = req.query;
  events = events.filter((e) => !e.cancelled); // cancelled events never show in public listings
  if (cat && cat !== "all") events = events.filter((e) => e.cat === cat);
  if (organizer) events = events.filter((e) => e.organizer === organizer);
  if (q) {
    const t = String(q).toLowerCase();
    events = events.filter((e) =>
      (e.title + e.organizer + e.area + e.venue + (e.tags || []).join(" ")).toLowerCase().includes(t)
    );
  }
  res.json(events);
});

app.get("/api/events/:id", (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  res.json(e);
});

app.post("/api/events", upload.single("image"), async (req, res) => {
  try {
    const b = req.body;
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Title is required" });
    if (!b.venue || !b.venue.trim()) return res.status(400).json({ error: "Venue is required" });

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
    const ev = {
      id,
      title: refined.title,
      organizer: (b.organizer || "You").trim(),
      cat: b.cat || "community",
      startsAt: refined.startsAt || new Date(Date.now() + 3 * 3600e3).toISOString(),
      endsAt: b.endsAt || null,
      venue: (refined.venue || b.venue).trim(),
      area: (refined.area || b.area || "Muscat").trim(),
      lat: b.lat ? Number(b.lat) : 23.6100,
      lng: b.lng ? Number(b.lng) : 58.5400,
      distanceKm: Number(b.distanceKm) || +(Math.random() * 8 + 1).toFixed(1),
      price: Math.max(0, Number(b.price) || 0),
      capacity: Math.max(1, Number(b.capacity) || 50),
      sold: 0,
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
    db.insert(ev);
    res.status(201).json(ev);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// book / RSVP — decrements availability by increasing sold
app.post("/api/events/:id/book", async (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  if (e.cancelled) return res.status(410).json({ error: "This event was cancelled" });
  if (e.ticketingType && e.ticketingType !== "weyn") {
    return res.status(400).json({ error: "This event isn't ticketed through Weyn — see externalTicketUrl/organizerContact instead" });
  }
  const qty = Math.max(1, Number(req.body?.qty) || 1);
  if (e.sold + qty > e.capacity) return res.status(409).json({ error: "Not enough tickets left" });
  db.update(e.id, { sold: e.sold + qty });

  const deviceId = req.body?.deviceId;
  if (deviceId) {
    const account = req.body?.email ? { email: req.body.email, name: req.body.name } : null;
    db.addBooking(deviceId, e.id, account);
    const token = db.tokenForDevice(deviceId);
    if (token) sendPush(token, { title: "You're going! 🎟", body: `${e.title} — we'll remind you before it starts.` }).catch(() => {});
  }
  res.json(db.get(e.id));
});

// ---- organizer event management ----
const EDITABLE_FIELDS = ["title", "blurb", "price", "capacity", "startsAt", "refundPolicy", "venue", "area", "minAge", "tags", "ticketingType", "externalTicketUrl", "organizerContact"];
app.patch("/api/events/:id", (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
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
  res.json(db.update(e.id, patch));
});

app.post("/api/events/:id/cancel", (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  res.json(db.update(e.id, { cancelled: true }));
});

app.post("/api/events/:id/duplicate", (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  const nextWeek = new Date(new Date(e.startsAt).getTime() + 7 * 864e5).toISOString();
  const copy = { ...e, id: slug(e.title) + "-" + crypto.randomUUID().slice(0, 4), sold: 0, cancelled: false, startsAt: nextWeek };
  db.insert(copy);
  res.status(201).json(copy);
});

app.get("/api/events/:id/attendees", (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  res.json(db.attendeesForEvent(e.id));
});

// ---- Google Sign-In ----
// Verifies the ID token with Google's tokeninfo endpoint (no extra JWT library
// needed). If GOOGLE_CLIENT_ID is set, also checks the token was issued for
// this app specifically — skip that check if unset so this still works before
// you've configured a client ID, rather than hard-failing.
app.post("/api/auth/google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "idToken is required" });
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return res.status(401).json({ error: "Invalid Google token" });
    const info = await r.json();
    if (process.env.GOOGLE_CLIENT_ID && info.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: "Token was not issued for this app" });
    }
    res.json({ email: info.email, name: info.name || info.email, picture: info.picture || null });
  } catch {
    res.status(502).json({ error: "Couldn't verify token with Google" });
  }
});

// ---- push notifications ----
app.get("/api/push/status", (_req, res) => res.json({ configured: pushConfigured() }));

app.post("/api/push/register", (req, res) => {
  const { deviceId, token, platform } = req.body || {};
  if (!deviceId || !token) return res.status(400).json({ error: "deviceId and token are required" });
  db.upsertPushToken(deviceId, token, platform || "ios");
  res.json({ ok: true });
});

// dev helper: manually fire a push to a registered device to confirm the pipeline end-to-end
app.post("/api/push/test", async (req, res) => {
  const { deviceId } = req.body || {};
  const token = deviceId && db.tokenForDevice(deviceId);
  if (!token) return res.status(404).json({ error: "No push token registered for that deviceId" });
  const result = await sendPush(token, { title: "Weyn", body: "Test notification — if you see this, push works! 🎉" });
  res.json(result);
});

// reminder scanner — every 5 min, notify devices whose booked event starts in ~2h
const REMIND_LEAD_MS = 2 * 3600e3;
const SCAN_EVERY_MS = 5 * 60e3;
setInterval(async () => {
  const now = Date.now();
  const due = db.duePendingReminders(now + REMIND_LEAD_MS - SCAN_EVERY_MS, now + REMIND_LEAD_MS);
  for (const b of due) {
    const token = db.tokenForDevice(b.deviceId);
    const e = db.get(b.eventId);
    if (token && e) {
      await sendPush(token, { title: "Starting soon ⏰", body: `${e.title} starts in about 2 hours at ${e.venue}.` });
    }
    db.markReminded(b.deviceId, b.eventId);
  }
}, SCAN_EVERY_MS).unref();

// organizer dashboard summary
app.get("/api/organizer/:name/summary", (req, res) => {
  const mine = db.all().filter((e) => e.organizer === req.params.name);
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
app.post("/api/import/instagram", async (req, res) => {
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
app.get("/api/events/:id/marketing", async (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  let copy = db.getMarketing(e.id);
  if (!copy) {
    copy = await generateMarketingCopy(e);
    db.setMarketing(e.id, copy);
  }
  res.json(copy);
});

app.post("/api/events/:id/marketing/regenerate", async (req, res) => {
  const e = db.get(req.params.id);
  if (!e) return res.status(404).json({ error: "Event not found" });
  const copy = await generateMarketingCopy(e);
  db.setMarketing(e.id, copy);
  res.json(copy);
});

// multer/upload errors
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Upload failed" });
});

// hosts like Render/Fly/Railway inject PORT; local dev keeps using API_PORT/4000
const PORT = process.env.PORT || process.env.API_PORT || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`[weyn] API listening on port ${PORT}`));
