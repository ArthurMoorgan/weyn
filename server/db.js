import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter instead of a datasource url
// in schema.prisma — see https://pris.ly/d/prisma7-client-config
//
// Lazily constructed (NOT at module top-level): Cloudflare Workers forbid
// any async I/O — including opening a DB connection pool — outside of an
// actual request handler's execution ("global scope"). Constructing
// PrismaClient/pg-pool eagerly at import time crashes the Workers deploy
// (`Disallowed operation called within global scope`). This Proxy defers
// the real construction until the first property access, which only ever
// happens from inside a route handler — same object identity either way,
// so no call site (`db.prisma.event.findMany()` etc) needs to change.
let _prisma = null;
function realPrisma() {
  if (!_prisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}
export const prisma = new Proxy({}, { get: (_t, prop) => realPrisma()[prop] });

// ---- date helpers: build seed relative to "now" so it's always upcoming ----
function at(dayOffset, hour, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d;
}
function nextWeekday(target, hour, min = 0) {
  // target: 0=Sun..6=Sat ; returns next occurrence (>= today)
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, min, 0, 0);
  return d;
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

export function seed() {
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
  ].map((e) => ({ ...e, cancelled: false, lat: COORDS[e.id]?.[0] ?? 23.6100, lng: COORDS[e.id]?.[1] ?? 58.5400 }));
}

// ---- shape a Prisma Event (with tiers include) into the flat frontend shape ----
function shape(e) {
  if (!e) return null;
  const { tiers, bookings, createdAt, deletedAt, ...rest } = e;
  return {
    ...rest,
    tiers: tiers && tiers.length ? tiers.map(({ event, bookings: _b, ...t }) => t) : null,
  };
}

// Matches src/api.ts's CATS (minus the "all" filter pseudo-value) — the
// source of truth for which `cat` strings are valid, so event creation can
// no longer silently accept an arbitrary typo'd category.
export const CATEGORY_SEED = [
  { key: "music", label: "Live music" },
  { key: "sports", label: "Sports" },
  { key: "food", label: "Food" },
  { key: "culture", label: "Culture" },
  { key: "cars", label: "Car meets" },
  { key: "workshop", label: "Workshops" },
  { key: "community", label: "Community" },
];

// Exported, NOT auto-run at import time — Cloudflare Workers forbid async
// I/O at module scope (same reason `prisma` above is a lazy Proxy). Called
// explicitly from server/index.js (plain Node local dev) on startup; the
// Workers entry (server/worker.js) never calls these, since production
// Postgres already has real data from local dev against the same database.
export async function seedIfEmpty() {
  const count = await prisma.event.count();
  if (count > 0) return;
  for (const e of seed()) {
    await prisma.event.create({ data: e });
  }
}
export async function seedCategoriesIfEmpty() {
  const count = await prisma.category.count();
  if (count > 0) return;
  for (const c of CATEGORY_SEED) await prisma.category.create({ data: c });
}

export const db = {
  async all() {
    const events = await prisma.event.findMany({ where: { deletedAt: null }, include: { tiers: true } });
    return events.map(shape);
  },
  async get(id) {
    const e = await prisma.event.findUnique({ where: { id, deletedAt: null }, include: { tiers: true } });
    return shape(e);
  },
  async remove(id) {
    return prisma.event.update({ where: { id }, data: { deletedAt: new Date() } });
  },
  async insert(ev) {
    const { tiers, ...rest } = ev;
    const e = await prisma.event.create({
      data: {
        ...rest,
        cancelled: rest.cancelled ?? false,
        tiers: tiers && tiers.length
          ? { create: tiers.map(({ id, ...t }) => t) }
          : undefined,
      },
      include: { tiers: true },
    });
    return shape(e);
  },
  async update(id, patch) {
    const { tiers, ...scalar } = patch;
    if (tiers) {
      await prisma.$transaction(
        tiers.map((t) => prisma.tier.update({ where: { id: t.id }, data: { sold: t.sold } }))
      );
    }
    const exists = await prisma.event.findUnique({ where: { id } });
    if (!exists) return null;
    const e = await prisma.event.update({ where: { id }, data: scalar, include: { tiers: true } });
    return shape(e);
  },
  async reseed() {
    await prisma.payment.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.tier.deleteMany();
    await prisma.event.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.marketingAsset.deleteMany();
    for (const e of seed()) await prisma.event.create({ data: e });
    return db.all();
  },

  // ---- generated marketing copy (cached per event) ----
  async getMarketing(eventId) {
    return prisma.marketingAsset.findUnique({ where: { eventId } });
  },
  async setMarketing(eventId, copy) {
    await prisma.marketingAsset.upsert({
      where: { eventId },
      create: { eventId, ...copy },
      update: { ...copy },
    });
  },

  // ---- push tokens (one active token per device) ----
  async upsertPushToken(deviceId, token, platform) {
    await prisma.pushToken.upsert({
      where: { deviceId },
      create: { deviceId, token, platform },
      update: { token, platform, registeredAt: new Date() },
    });
  },
  async tokenForDevice(deviceId) {
    const t = await prisma.pushToken.findUnique({ where: { deviceId } });
    return t?.token;
  },

  // ---- bookings (device -> event, for reminder targeting + attendee lists) ----
  async addBooking(deviceId, eventId, account, tierId) {
    if (!deviceId) return;
    await prisma.booking.create({
      data: {
        deviceId, eventId, tierId: tierId || null, status: "paid",
        email: account?.email || null, name: account?.name || null,
      },
    });
  },
  async attendeesForEvent(eventId) {
    const bookings = await prisma.booking.findMany({
      where: { eventId, status: "paid" },
      select: { name: true, email: true, bookedAt: true },
    });
    return bookings;
  },
  async duePendingReminders(windowStartMs, windowEndMs) {
    const bookings = await prisma.booking.findMany({
      where: {
        reminded: false,
        status: "paid",
        event: { startsAt: { gte: new Date(windowStartMs), lte: new Date(windowEndMs) } },
      },
      select: { deviceId: true, eventId: true },
    });
    return bookings.filter((b) => b.deviceId);
  },
  async markReminded(deviceId, eventId) {
    await prisma.booking.updateMany({ where: { deviceId, eventId }, data: { reminded: true } });
  },

  // ---- capacity: atomic, conditional increments (no read-then-write race) ----
  // Plain `sold += qty` after a separate read (the old approach) is a classic
  // TOCTOU bug — two concurrent requests can both read `sold=capacity-1` and
  // both "succeed", overselling by however many requests raced. Prisma can't
  // express a column-vs-column WHERE (sold + qty <= capacity) through its
  // query builder, so this is raw SQL: the UPDATE's WHERE clause IS the
  // capacity check, evaluated atomically by Postgres at write time. Returns
  // the updated row if the claim succeeded, or null if it didn't fit.
  async claimTierCapacity(tierId, qty) {
    const rows = await prisma.$queryRaw`
      UPDATE "Tier" SET sold = sold + ${qty}
      WHERE id = ${tierId} AND sold + ${qty} <= capacity
      RETURNING id, name, capacity, sold
    `;
    return rows[0] || null;
  },
  async claimEventCapacity(eventId, qty) {
    const rows = await prisma.$queryRaw`
      UPDATE "Event" SET sold = sold + ${qty}
      WHERE id = ${eventId} AND sold + ${qty} <= capacity
      RETURNING id, capacity, sold
    `;
    return rows[0] || null;
  },
  async releaseTierCapacity(tierId, qty) {
    await prisma.$executeRaw`UPDATE "Tier" SET sold = GREATEST(0, sold - ${qty}) WHERE id = ${tierId}`;
  },
  async releaseEventCapacity(eventId, qty) {
    await prisma.$executeRaw`UPDATE "Event" SET sold = GREATEST(0, sold - ${qty}) WHERE id = ${eventId}`;
  },

  // ---- tickets (one row per admitted seat — see schema.prisma's comment) ----
  async issueTickets(bookingId, eventId, qty) {
    const data = Array.from({ length: qty }, () => ({ bookingId, eventId }));
    await prisma.ticket.createMany({ data });
    return prisma.ticket.findMany({ where: { bookingId } });
  },
  async ticketsForBooking(bookingId) {
    return prisma.ticket.findMany({ where: { bookingId } });
  },
  async getTicketByCode(code) {
    return prisma.ticket.findUnique({ where: { code }, include: { event: true, booking: true } });
  },
  async checkInTicket(code, staffUserId) {
    // Conditional on checkedInAt still being null — same atomic-claim
    // pattern as capacity above, so two staff scanning the same code at the
    // same instant can't both "successfully" admit the same seat.
    const rows = await prisma.$queryRaw`
      UPDATE "Ticket" SET "checkedInAt" = now(), "checkedInBy" = ${staffUserId}
      WHERE code = ${code} AND "checkedInAt" IS NULL
      RETURNING id, "eventId", "bookingId", "checkedInAt"
    `;
    return rows[0] || null;
  },

  // ---- audit log (see schema.prisma's AuditLog comment) ----
  async audit(action, { actorId, entityType, entityId, metadata } = {}) {
    await prisma.auditLog.create({
      data: { action, actorId: actorId || null, entityType, entityId, metadata },
    });
  },

  // ---- checkout / payments ----
  async createPendingBooking({ eventId, tierId, deviceId, account, qty }) {
    return prisma.booking.create({
      data: {
        eventId, tierId: tierId || null, deviceId: deviceId || null, qty: qty || 1,
        status: "pending",
        email: account?.email || null, name: account?.name || null,
      },
    });
  },
  async getBooking(id) {
    return prisma.booking.findUnique({ where: { id }, include: { payment: true, event: true, tier: true } });
  },
  async expireStalePendingBookings(olderThanMs) {
    await prisma.booking.updateMany({
      where: { status: "pending", bookedAt: { lt: new Date(Date.now() - olderThanMs) } },
      data: { status: "expired" },
    });
  },

  // ---- users (real identity, backing auth — see server/auth.js) ----
  async upsertUserFromGoogle({ googleSub, email, name, avatarUrl }) {
    return prisma.user.upsert({
      where: { email },
      create: { email, name, avatarUrl, googleSub },
      update: { name, avatarUrl, googleSub },
    });
  },
  async getUserById(id) {
    return prisma.user.findUnique({ where: { id, deletedAt: null } });
  },
  // forces every outstanding session JWT for this user to fail attachUser's
  // tokenVersion check — used when banning a user or changing their role
  async revokeSessions(userId) {
    return prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  },

  // ---- categories ----
  async listCategories() {
    return prisma.category.findMany({ orderBy: { label: "asc" } });
  },
  async isValidCategory(key) {
    return !!(await prisma.category.findUnique({ where: { key } }));
  },

  // ---- analytics (fire-and-forget; callers should .catch(() => {})) ----
  async track(type, { userId, entityId, metadata } = {}) {
    await prisma.analyticsEvent.create({ data: { type, userId: userId || null, entityId: entityId || null, metadata } });
  },
};
