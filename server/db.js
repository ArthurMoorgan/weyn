import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a host with a persistent disk (Render, Fly volumes, etc.) survive
// redeploys. Defaults to the repo folder for local dev.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, "data.json");

// ---- date helpers: build seed relative to "now" so it's always upcoming ----
function at(dayOffset, hour, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}
function nextWeekday(target, hour, min = 0) {
  // target: 0=Sun..6=Sat ; returns next occurrence (>= today)
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

// approximate lat/lng for each seed venue (Muscat)
const COORDS = {
  "street-food":   [23.6205, 58.5680],
  "boxing-night":  [23.6090, 58.2790],
  "rooftop-oud":   [23.6140, 58.5930],
  "jazz-supper":   [23.6150, 58.4830],
  "pottery":       [23.5900, 58.4200],
  "car-meet":      [23.6110, 58.4760],
  "uni-fest":      [23.5880, 58.1670],
  "beach-cleanup": [23.5360, 58.6450],
  "indie-concert": [23.6095, 58.2800],
  "food-festival": [23.5240, 58.5010],
  "half-marathon": [23.6210, 58.5670],
};

function seed() {
  return [
    {
      id: "street-food", title: "Mutrah Night Food Market", organizer: "Mutrah Collective",
      cat: "food", startsAt: at(0, 18, 0), endsAt: at(0, 23, 0),
      venue: "Mutrah Corniche", area: "Mutrah", distanceKm: 4.8,
      price: 0, capacity: 999, sold: 240, image: null, color: "#B5562F", glyph: "🍢",
      blurb: "Twenty stalls along the water — shawarma, grilled hammour, karak, and Omani halwa. Free entry, bring an appetite.",
      tags: ["outdoor", "family-friendly"], refundPolicy: "Free entry", minAge: 0,
    },
    {
      id: "boxing-night", title: "Muscat Fight Night III", organizer: "Gulf Combat Club",
      cat: "sports", startsAt: at(0, 20, 0), endsAt: at(0, 23, 30),
      venue: "Al Mouj Arena", area: "Al Mouj", distanceKm: 3.4,
      price: 12, capacity: 400, sold: 362, image: null, color: "#2A2E45", glyph: "🥊",
      blurb: "Eight amateur bouts, a title fight, and the loudest crowd in the city. Doors at 7.",
      tags: ["18+", "indoor"], refundPolicy: "No refunds within 24h", minAge: 16,
    },
    {
      id: "rooftop-oud", title: "Oud & Coffee on the Roof", organizer: "Bait Al Zubair",
      cat: "music", startsAt: at(0, 21, 30), endsAt: at(0, 23, 30),
      venue: "Old Muscat rooftop", area: "Old Muscat", distanceKm: 6.1,
      price: 5, capacity: 60, sold: 48, image: null, color: "#2F5D52", glyph: "🎶",
      blurb: "Live oud under the stars with cardamom coffee and dates. Intimate, sixty seats.",
      tags: ["acoustic", "outdoor"], refundPolicy: "Refund up to 48h before", minAge: 0,
    },
    {
      id: "jazz-supper", title: "Jazz Supper Club", organizer: "The Cellar",
      cat: "music", startsAt: at(0, 22, 0), endsAt: at(1, 1, 0),
      venue: "The Cellar, Shatti", area: "Shatti Al Qurum", distanceKm: 2.2,
      price: 9, capacity: 50, sold: 44, image: null, color: "#2C3350", glyph: "🎷",
      blurb: "A trio, low light, and a short menu. Late seating only.",
      tags: ["indoor", "21+"], refundPolicy: "No refunds", minAge: 21,
    },
    {
      id: "pottery", title: "Beginner Pottery Wheel", organizer: "Clay House Studio",
      cat: "workshop", startsAt: at(1, 11, 0), endsAt: at(1, 13, 0),
      venue: "Clay House, Azaiba", area: "Azaiba", distanceKm: 7.2,
      price: 18, capacity: 10, sold: 6, image: null, color: "#7A5230", glyph: "🏺",
      blurb: "Two hours on the wheel, all clay and tools included. Walk out with a bowl that is almost certainly a bowl.",
      tags: ["beginner", "indoor"], refundPolicy: "Refund up to 24h before", minAge: 12,
    },
    {
      id: "car-meet", title: "Friday JDM Car Meet", organizer: "Muscat Auto Scene",
      cat: "cars", startsAt: nextWeekday(5, 18, 30), endsAt: nextWeekday(5, 21, 0),
      venue: "Qurum Beach car park", area: "Qurum", distanceKm: 5.0,
      price: 0, capacity: 999, sold: 130, image: null, color: "#3A4668", glyph: "🚗",
      blurb: "Skylines, Supras, and a few surprises. Coffee truck on site.",
      tags: ["outdoor", "free"], refundPolicy: "Free entry", minAge: 0,
    },
    {
      id: "uni-fest", title: "SQU Spring Culture Fest", organizer: "SQU Student Union",
      cat: "culture", startsAt: nextWeekday(6, 16, 0), endsAt: nextWeekday(6, 22, 0),
      venue: "Sultan Qaboos University", area: "Al Khoudh", distanceKm: 11.3,
      price: 2, capacity: 800, sold: 210, image: null, color: "#6B3F5B", glyph: "🎏",
      blurb: "Food from twelve countries, a poetry stage, henna, and a night market run entirely by students.",
      tags: ["family-friendly", "outdoor"], refundPolicy: "Refund up to 7 days before", minAge: 0,
    },
    {
      id: "beach-cleanup", title: "Sunrise Beach Cleanup + Yoga", organizer: "Green Muscat",
      cat: "community", startsAt: at(5, 6, 0), endsAt: at(5, 8, 30),
      venue: "Yiti Beach", area: "Yiti", distanceKm: 18.4,
      price: 0, capacity: 80, sold: 52, image: null, color: "#4A6B52", glyph: "🌅",
      blurb: "Gloves and bags provided. Stay for a free sunrise yoga flow and karak afterwards.",
      tags: ["outdoor", "wellness"], refundPolicy: "Free entry", minAge: 0,
    },
    {
      id: "indie-concert", title: "Desert Sessions: Live", organizer: "Wadi Sound",
      cat: "music", startsAt: at(8, 20, 0), endsAt: at(8, 23, 30),
      venue: "Amphitheatre, Al Mouj", area: "Al Mouj", distanceKm: 3.6,
      price: 20, capacity: 1200, sold: 540, image: null, color: "#3E2B54", glyph: "🎸",
      blurb: "Three indie acts under the open sky. Food trucks from 6pm. The headline drop is at 10.",
      tags: ["outdoor", "16+"], refundPolicy: "Refund up to 7 days before", minAge: 16,
    },
    {
      id: "food-festival", title: "Muscat Food Festival 2026", organizer: "Visit Muscat",
      cat: "food", startsAt: at(12, 15, 0), endsAt: at(14, 23, 0),
      venue: "Al Amerat Park", area: "Al Amerat", distanceKm: 14.0,
      price: 3, capacity: 5000, sold: 1180, image: null, color: "#8A4B2B", glyph: "🍽",
      blurb: "Three days, eighty vendors, a chef stage, and a kids' zone. Weekend pass available.",
      tags: ["family-friendly", "weekend"], refundPolicy: "Refund up to 7 days before", minAge: 0,
    },
    {
      id: "half-marathon", title: "Corniche Half Marathon", organizer: "Run Oman",
      cat: "sports", startsAt: at(10, 5, 30), endsAt: at(10, 10, 0),
      venue: "Mutrah Corniche start line", area: "Mutrah", distanceKm: 4.9,
      price: 8, capacity: 2000, sold: 1320, image: null, color: "#1F5E63", glyph: "🏃",
      blurb: "21km along the water before the heat. Chip timing, finisher medal, hydration every 3km.",
      tags: ["outdoor", "registration"], refundPolicy: "No refunds", minAge: 16,
    },
  ].map((e) => ({ ...e, lat: COORDS[e.id]?.[0] ?? 23.6100, lng: COORDS[e.id]?.[1] ?? 58.5400 }));
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (Array.isArray(raw.events)) {
      raw.pushTokens ||= [];
      raw.bookings ||= [];
      raw.marketingAssets ||= [];
      return raw;
    }
  } catch { /* fall through to seed */ }
  const data = { events: seed(), pushTokens: [], bookings: [], marketingAssets: [] };
  save(data);
  return data;
}

let data = load();
function save(d = data) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

export const db = {
  all() { return data.events; },
  get(id) { return data.events.find((e) => e.id === id); },
  insert(ev) { data.events.unshift({ cancelled: false, ...ev }); save(); return ev; },
  update(id, patch) {
    const e = db.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    save();
    return e;
  },
  reseed() { data = { events: seed(), pushTokens: [], bookings: [], marketingAssets: [] }; save(); return data.events; },

  // ---- generated marketing copy (cached per event) ----
  getMarketing(eventId) { return data.marketingAssets.find((m) => m.eventId === eventId) || null; },
  setMarketing(eventId, copy) {
    data.marketingAssets = data.marketingAssets.filter((m) => m.eventId !== eventId);
    data.marketingAssets.push({ eventId, ...copy });
    save();
  },

  // ---- push tokens (one active token per device) ----
  upsertPushToken(deviceId, token, platform) {
    data.pushTokens = data.pushTokens.filter((t) => t.deviceId !== deviceId);
    data.pushTokens.push({ deviceId, token, platform, registeredAt: new Date().toISOString() });
    save();
  },
  tokenForDevice(deviceId) { return data.pushTokens.find((t) => t.deviceId === deviceId)?.token; },

  // ---- bookings (device -> event, for reminder targeting + attendee lists) ----
  addBooking(deviceId, eventId, account) {
    if (!deviceId) return;
    data.bookings.push({
      deviceId, eventId, bookedAt: new Date().toISOString(), reminded: false,
      email: account?.email || null, name: account?.name || null,
    });
    save();
  },
  attendeesForEvent(eventId) {
    return data.bookings
      .filter((b) => b.eventId === eventId)
      .map((b) => ({ name: b.name, email: b.email, bookedAt: b.bookedAt }));
  },
  duePendingReminders(windowStartMs, windowEndMs) {
    return data.bookings.filter((b) => {
      if (b.reminded) return false;
      const e = db.get(b.eventId);
      if (!e) return false;
      const t = new Date(e.startsAt).getTime();
      return t >= windowStartMs && t <= windowEndMs;
    });
  },
  markReminded(deviceId, eventId) {
    const b = data.bookings.find((x) => x.deviceId === deviceId && x.eventId === eventId);
    if (b) { b.reminded = true; save(); }
  },
};
