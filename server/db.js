import { PrismaClient, Prisma } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "crypto";
import { getCurrentUserId } from "./request-context.js";

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

// ---- RLS Phase 0 scaffolding — NOT wired into the exported `prisma` above ----
// See prisma/rls-phase0/ for the (not-applied) migration this is meant to
// eventually support, and server/request-context.js for where the per-request
// user id comes from.
//
// This is deliberately kept as a separate, unused export rather than wired
// into the default client. `SET LOCAL app.user_id = ...` is genuinely a
// no-op today (no RLS policies exist yet on any live table to read that
// session variable), so wiring it in would not change any current query
// behavior — but it DOES mean wrapping every single query in an extra
// transaction + a `SET LOCAL` round trip, which is a real (if probably
// small) latency/connection-overhead cost on every request, on the hottest
// path in the app, for zero behavioral benefit until Phase 1/2 land. Given
// this is explicitly the hot path used by every request, the safer choice is
// to leave today's `prisma` export completely untouched and give a future
// session (once staging validation from prisma/rls-phase0/README.md is done
// and policies are actually enabled) a concrete, already-written starting
// point to wire in deliberately, rather than silently changing performance
// characteristics now for a feature that isn't active yet.
//
// Once ready to enable, a future session would do roughly:
//   import { withRlsContext } from "./db.js";
//   const scopedPrisma = withRlsContext(realPrisma());
// and swap `prisma` call sites in db.js over to `scopedPrisma`, table by
// table, alongside actually enabling each table's RLS policies — not as a
// single flag-flip across everything at once.
export function withRlsContext(client) {
  return client.$extends({
    name: "rls-context",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const userId = getCurrentUserId();
          // Only meaningful once RLS policies exist to read app.user_id —
          // until then this is a harmless SET LOCAL inside a transaction
          // that nothing consumes.
          return client.$transaction(async (tx) => {
            if (userId) {
              await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
            } else {
              await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`;
            }
            return query(args);
          });
        },
      },
    },
  });
}

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
  async upsertPushToken(deviceId, token, platform, deviceSecret, userId = null) {
    const secretHash = deviceSecret ? crypto.createHash("sha256").update(deviceSecret).digest("hex") : null;
    const existing = await prisma.pushToken.findUnique({ where: { deviceId } });
    if (existing?.secretHash && existing.secretHash !== secretHash) {
      throw new Error("Invalid device secret");
    }
    await prisma.pushToken.upsert({
      where: { deviceId },
      create: { deviceId, token, platform, secretHash, userId },
      update: { token, platform, secretHash: existing?.secretHash || secretHash, userId: userId || existing?.userId, registeredAt: new Date() },
    });
  },
  async tokenForDevice(deviceId) {
    const t = await prisma.pushToken.findUnique({ where: { deviceId } });
    return t?.token;
  },
  // All of a user's native push tokens — a user may have registered from
  // more than one device.
  async tokensForUser(userId) {
    const rows = await prisma.pushToken.findMany({ where: { userId } });
    return rows.map((r) => r.token);
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

  // ---- automated multi-touch reminders (scheduledAnnouncements feature) ----
  // Distinct from duePendingReminders above (a fixed, always-on 2h-before
  // push every event gets) — this is the organizer-configured
  // Event.reminderSchedule (hours-before-start, e.g. [72, 24]). `scanWindowMs`
  // should match the caller's actual scan interval — an offset is "due" the
  // one tick where hoursUntilStart first drops to/below it, and
  // autoRemindersSent (checked per booking, not per event) stops it firing
  // again on the next tick.
  async dueAutomatedReminders(nowMs, scanWindowMs) {
    const now = new Date(nowMs);
    const events = await prisma.event.findMany({
      where: { cancelled: false, deletedAt: null, startsAt: { gt: now }, reminderSchedule: { isEmpty: false } },
      select: { id: true, title: true, venue: true, area: true, startsAt: true, reminderSchedule: true },
    });
    const windowHours = scanWindowMs / 3600000;
    const due = [];
    for (const e of events) {
      const hoursUntil = (e.startsAt.getTime() - nowMs) / 3600000;
      for (const offset of e.reminderSchedule) {
        if (hoursUntil > offset || hoursUntil <= offset - windowHours) continue;
        const bookings = await prisma.booking.findMany({
          where: { eventId: e.id, status: "paid", email: { not: null }, NOT: { autoRemindersSent: { has: offset } } },
          select: { id: true, email: true, name: true, deviceId: true },
        });
        if (bookings.length) due.push({ event: e, offset, bookings });
      }
    }
    return due;
  },
  async markAutoRemindersSent(bookingIds, offset) {
    if (!bookingIds.length) return;
    await prisma.booking.updateMany({ where: { id: { in: bookingIds } }, data: { autoRemindersSent: { push: offset } } });
  },

  // ---- Messaging Center: scheduled campaigns ----
  // Extends the existing "send now" bulk-notify (POST /api/events/:id/notify)
  // with a future send date — a Campaign row sits in "scheduled" until
  // runCampaignScan picks it up, same polling pattern as the reminder scan
  // above rather than a separate job queue.
  async createCampaign({ organizerId, eventId, subject, message, scheduledFor }) {
    return prisma.campaign.create({
      data: { organizerId, eventId, channel: "email", subject, message, scheduledFor: scheduledFor || null, status: scheduledFor ? "scheduled" : "sent", sentAt: scheduledFor ? null : new Date() },
    });
  },
  async listCampaigns(eventId) {
    return prisma.campaign.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } });
  },
  async cancelCampaign(id, organizerId) {
    const c = await prisma.campaign.findUnique({ where: { id } });
    if (!c || c.organizerId !== organizerId || c.status !== "scheduled") return null;
    return prisma.campaign.update({ where: { id }, data: { status: "cancelled" } });
  },
  async dueCampaigns(nowMs) {
    return prisma.campaign.findMany({
      where: { status: "scheduled", scheduledFor: { lte: new Date(nowMs) } },
      include: { event: { select: { id: true, title: true } } },
    });
  },
  async markCampaignSent(id) {
    await prisma.campaign.update({ where: { id }, data: { status: "sent", sentAt: new Date() } });
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
  // Team activity trail — direct "event" entries (cancel, feature, invite…)
  // plus ticket check-ins, which are logged as entityType "ticket" with the
  // event id tucked into metadata rather than entityId, so they need their
  // own OR clause to show up here.
  async eventAuditLog(eventId) {
    const [direct, checkins] = await Promise.all([
      prisma.auditLog.findMany({ where: { entityType: "event", entityId: eventId }, orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { name: true, email: true } } } }),
      prisma.auditLog.findMany({ where: { entityType: "ticket", action: "ticket.checkin", metadata: { path: ["eventId"], equals: eventId } }, orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { name: true, email: true } } } }),
    ]);
    return [...direct, ...checkins].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },

  // ---- checkout / payments ----
  async createPendingBooking({ eventId, tierId, deviceId, account, qty, utm }) {
    return prisma.booking.create({
      data: {
        eventId, tierId: tierId || null, deviceId: deviceId || null, qty: qty || 1,
        status: "pending",
        accessToken: crypto.randomBytes(24).toString("base64url"),
        email: account?.email || null, name: account?.name || null,
        utmSource: utm?.source || null, utmMedium: utm?.medium || null, utmCampaign: utm?.campaign || null,
      },
    });
  },
  async getBooking(id) {
    return prisma.booking.findUnique({ where: { id }, include: { payment: true, event: true, tier: true } });
  },
  async expireStalePendingBookings(olderThanMs) {
    // organizer_payment bookings deliberately excluded — an attendee paying
    // by bank transfer or an external link can take far longer than a
    // gateway checkout session to clear, and there's no capacity actually
    // held against them until the organizer confirms (see
    // POST /api/events/:id/organizer-checkout), so there's nothing this
    // sweep would even be reclaiming for them.
    await prisma.booking.updateMany({
      where: {
        status: "pending", bookedAt: { lt: new Date(Date.now() - olderThanMs) },
        event: { ticketingType: { not: "organizer_payment" } },
      },
      data: { status: "expired" },
    });
  },

  // ---- users (real identity, backing auth — see server/auth.js) ----
  // Links by clerkUserId first (repeat sign-in), then falls back to matching
  // an existing row by email (a legacy Google-Sign-In-era account, or a row
  // created by an invite/booking before this user ever signed in) so prior
  // ownership/history isn't orphaned when someone first logs in via Clerk.
  async upsertUserFromClerk({ clerkUserId, email, name, avatarUrl }) {
    const existing = await prisma.user.findUnique({ where: { clerkUserId } });
    if (existing) {
      return prisma.user.update({ where: { id: existing.id }, data: { name, avatarUrl, email } });
    }
    const byEmail = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (byEmail) {
      return prisma.user.update({ where: { id: byEmail.id }, data: { clerkUserId, name, avatarUrl } });
    }
    return prisma.user.create({ data: { email, name, avatarUrl, clerkUserId } });
  },
  async getUserById(id) {
    return prisma.user.findUnique({ where: { id, deletedAt: null } });
  },
  // Tracks security-sensitive role changes. Clerk owns real session lifetime;
  // use Clerk-side session revocation for immediate forced sign-out.
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

  // ---- team membership (event-scoped roles, see schema.prisma) ----
  async getTeamMembership(eventId, userId) {
    return prisma.eventTeamMember.findFirst({ where: { eventId, userId, status: "ACCEPTED" } });
  },
  async createTeamInvite({ eventId, invitedEmail, role, invitedBy, permissions }) {
    return prisma.eventTeamMember.create({
      data: { eventId, invitedEmail: invitedEmail.toLowerCase().trim(), role, invitedBy, permissions: permissions || [] },
    });
  },
  async listTeamMembers(eventId) {
    return prisma.eventTeamMember.findMany({
      where: { eventId, status: { not: "REVOKED" } },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
  },
  async getInviteByToken(token) {
    return prisma.eventTeamMember.findUnique({ where: { inviteToken: token }, include: { event: true } });
  },
  async acceptInvite(token, userId) {
    // token is cleared on accept — see schema.prisma's comment on why a used
    // link can't be replayed to re-grant access after acceptance
    return prisma.eventTeamMember.update({
      where: { inviteToken: token },
      data: { userId, status: "ACCEPTED", acceptedAt: new Date(), inviteToken: null },
    });
  },
  async revokeTeamMember(id) {
    return prisma.eventTeamMember.update({ where: { id }, data: { status: "REVOKED", inviteToken: null } });
  },
  async getTeamMemberById(id) {
    return prisma.eventTeamMember.findUnique({ where: { id } });
  },

  // ---- organizer-wide team (aggregated view over per-event memberships) ----
  // Deliberately NOT a new table/model — "org-wide roles" here means
  // inviting someone to every one of the organizer's current events at once
  // (still real EventTeamMember rows, still checked by the exact same
  // requireEventAccess middleware every per-event route already uses), not
  // a new access-control concept layered on top. Doesn't cover events
  // created AFTER the invite — a real limitation, flagged in the UI, traded
  // for not touching the auth core to ship this.
  async organizerActiveEventIds(userId) {
    const events = await prisma.event.findMany({ where: { ownerId: userId, deletedAt: null, cancelled: false }, select: { id: true } });
    return events.map((e) => e.id);
  },
  async organizerTeamMembers(userId) {
    const eventIds = await db.organizerActiveEventIds(userId);
    if (!eventIds.length) return [];
    const rows = await prisma.eventTeamMember.findMany({
      where: { eventId: { in: eventIds }, status: { not: "REVOKED" } },
      include: { user: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
    const byEmail = new Map();
    for (const r of rows) {
      const key = r.invitedEmail.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        existing.eventCount += 1;
        existing.memberIds.push(r.id);
        if (r.status === "PENDING") existing.hasPending = true;
      } else {
        byEmail.set(key, {
          email: r.invitedEmail, name: r.user?.name || null, role: r.role,
          hasPending: r.status === "PENDING", eventCount: 1, memberIds: [r.id],
        });
      }
    }
    return [...byEmail.values()];
  },
  async organizerTeamInvite({ userId, email, role, invitedBy }) {
    const eventIds = await db.organizerActiveEventIds(userId);
    const invites = [];
    for (const eventId of eventIds) {
      invites.push(await db.createTeamInvite({ eventId, invitedEmail: email, role, invitedBy }));
    }
    return invites;
  },
  async organizerTeamRevoke(userId, email) {
    const eventIds = await db.organizerActiveEventIds(userId);
    const normalized = email.toLowerCase().trim();
    await prisma.eventTeamMember.updateMany({
      where: { eventId: { in: eventIds }, invitedEmail: normalized, status: { not: "REVOKED" } },
      data: { status: "REVOKED", inviteToken: null },
    });
  },
  // events this user can manage: owns, or holds an accepted MANAGER/STAFF
  // membership on — used by the dashboard's "your events" list and summary
  async eventsAccessibleTo(userId) {
    const events = await prisma.event.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }],
      },
      include: { tiers: true },
      orderBy: { startsAt: "desc" },
    });
    return events.map(shape);
  },

  // ---- dashboard aggregates ----
  async dashboardSummary(userId) {
    const events = await prisma.event.findMany({
      where: { deletedAt: null, OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }] },
      select: { id: true, sold: true, price: true, capacity: true, startsAt: true, cancelled: true, tiers: { select: { sold: true, price: true } } },
    });
    const eventIds = events.map((e) => e.id);
    const now = new Date();
    const upcoming = events.filter((e) => !e.cancelled && new Date(e.startsAt) >= now).length;
    const totalAttendees = events.reduce((s, e) => s + e.sold, 0);
    const totalRevenue = events.reduce((s, e) => {
      if (e.tiers.length) return s + e.tiers.reduce((ts, t) => ts + t.sold * t.price, 0);
      return s + e.sold * e.price;
    }, 0);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const newRegistrationsToday = eventIds.length
      ? await prisma.booking.count({ where: { eventId: { in: eventIds }, status: "paid", bookedAt: { gte: todayStart } } })
      : 0;
    return {
      totalEvents: events.length,
      upcomingEvents: upcoming,
      totalAttendees,
      totalRevenue: +totalRevenue.toFixed(2),
      newRegistrationsToday,
    };
  },
  async recentActivity(userId, limit = 20) {
    const events = await prisma.event.findMany({
      where: { OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }] },
      select: { id: true },
    });
    const eventIds = events.map((e) => e.id);
    if (!eventIds.length) return [];
    const [bookings, audits] = await Promise.all([
      prisma.booking.findMany({
        where: { eventId: { in: eventIds } },
        orderBy: { bookedAt: "desc" },
        take: limit,
        select: { id: true, eventId: true, status: true, qty: true, bookedAt: true, name: true, email: true },
      }),
      prisma.auditLog.findMany({
        where: { entityType: "event", entityId: { in: eventIds } },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ]);
    const feed = [
      ...bookings.map((b) => ({ type: "booking", status: b.status, eventId: b.eventId, qty: b.qty, who: b.name || b.email || "Someone", at: b.bookedAt })),
      ...audits.map((a) => ({ type: "audit", action: a.action, eventId: a.entityId, at: a.createdAt })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
    return feed;
  },

  // ---- organizer dashboard rebuild: cross-event aggregates ----
  // These three back the /organizer dashboard's Overview/Attendees/Finance
  // sections. None of them existed before — every prior organizer query was
  // scoped to a single event. All three share the same "events this user
  // owns or manages" base set as eventsAccessibleTo/dashboardSummary above.
  async _organizerEventIds(userId) {
    const events = await prisma.event.findMany({
      where: { deletedAt: null, OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }] },
      select: { id: true },
    });
    return events.map((e) => e.id);
  },

  async organizerOverview(userId) {
    const events = await prisma.event.findMany({
      where: { deletedAt: null, OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }] },
      select: {
        id: true, title: true, startsAt: true, sold: true, capacity: true, cancelled: true,
        discoveryStatus: true, image: true, color: true, glyph: true,
        waitlistEntries: { select: { notifiedAt: true } },
      },
      orderBy: { startsAt: "asc" },
    });
    const eventIds = events.map((e) => e.id);
    const now = new Date();

    const needsAttention = [];
    for (const e of events) {
      if (e.cancelled) continue;
      if (e.discoveryStatus === "MANUAL_REVIEW") {
        needsAttention.push({ type: "manual_review", eventId: e.id, eventTitle: e.title, message: "Stuck in manual review — contact support if this doesn't clear soon." });
      }
      if (new Date(e.startsAt) >= now && e.sold === 0) {
        needsAttention.push({ type: "zero_sales", eventId: e.id, eventTitle: e.title, message: "Upcoming with zero tickets sold yet." });
      }
      const unnotified = e.waitlistEntries.filter((w) => !w.notifiedAt).length;
      if (unnotified > 0) {
        needsAttention.push({ type: "waitlist_pending", eventId: e.id, eventTitle: e.title, message: `${unnotified} waitlist ${unnotified === 1 ? "signup" : "signups"} not yet notified.` });
      }
      // Smart Notifications: a couple of derived, no-schema tips folded into
      // the same "needs attention" feed rather than a new destination —
      // organizers already check this list, so a new UI surface for these
      // would just be a second inbox nobody opens.
      if (e.capacity < 9000 && e.capacity > 0 && new Date(e.startsAt) >= now) {
        const soldPct = e.sold / e.capacity;
        if (soldPct >= 0.85) {
          needsAttention.push({ type: "selling_fast", eventId: e.id, eventTitle: e.title, message: `${Math.round(soldPct * 100)}% sold — consider raising the price or capacity for next time.` });
        }
      }
    }
    if (eventIds.length) {
      const pendingInvites = await prisma.eventTeamMember.findMany({
        where: { eventId: { in: eventIds }, status: "PENDING" },
        select: { eventId: true, invitedEmail: true, event: { select: { title: true } } },
      });
      for (const inv of pendingInvites) {
        needsAttention.push({ type: "pending_invite", eventId: inv.eventId, eventTitle: inv.event.title, message: `Team invite to ${inv.invitedEmail} still pending.` });
      }
    }

    const nextUpcoming = events.filter((e) => !e.cancelled && new Date(e.startsAt) >= now).slice(0, 3)
      .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, sold: e.sold, capacity: e.capacity, image: e.image, color: e.color, glyph: e.glyph }));

    // Revenue trend — last 14 days, bucketed by day. Mirrors eventAnalytics's
    // salesByDay shape but summed across every event this organizer manages.
    // Bucket keys and `since` are both derived via pure UTC millisecond math
    // (not setDate/setHours, which read the server process's LOCAL
    // timezone) so they line up exactly with bookedAt's own
    // toISOString().slice(0,10) key below — mixing local-time day
    // boundaries with UTC-formatted keys silently dropped a day's bookings
    // whenever the server's local timezone was ahead of UTC.
    const DAY_MS = 86400000;
    const since = new Date(Date.now() - 13 * DAY_MS);
    const trendDays = [];
    for (let i = 0; i < 14; i++) {
      trendDays.push(new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10));
    }
    const revenueByDay = Object.fromEntries(trendDays.map((d) => [d, 0]));
    if (eventIds.length) {
      const bookings = await prisma.booking.findMany({
        where: { eventId: { in: eventIds }, status: "paid", bookedAt: { gte: since } },
        select: { qty: true, bookedAt: true, tier: { select: { price: true } }, event: { select: { price: true } } },
      });
      for (const b of bookings) {
        const day = new Date(b.bookedAt).toISOString().slice(0, 10);
        if (!(day in revenueByDay)) continue;
        const price = b.tier ? b.tier.price : b.event.price;
        revenueByDay[day] += b.qty * price;
      }
    }
    const revenueTrend = trendDays.map((date) => ({ date, revenue: +revenueByDay[date].toFixed(2) }));

    return { needsAttention, nextUpcoming, revenueTrend, reputationScore: await db.reputationScore(userId, events) };
  },

  // ---- Organizer Reputation Score: a single 0-100 number blending sell-
  // through rate and attendee feedback ratings — both signals an organizer
  // can actually act on, not an opaque platform metric. Weighted 60/40
  // toward sell-through since feedback data is sparse for most organizers
  // early on; falls back to sell-through alone when there's no feedback yet.
  async reputationScore(organizerId, preloadedEvents) {
    const events = preloadedEvents || await prisma.event.findMany({
      where: { ownerId: organizerId, deletedAt: null, cancelled: false, capacity: { lt: 9000 } },
      select: { id: true, sold: true, capacity: true },
    });
    const finite = events.filter((e) => e.capacity > 0 && e.capacity < 9000);
    const avgSellThrough = finite.length ? finite.reduce((s, e) => s + e.sold / e.capacity, 0) / finite.length : null;
    const eventIds = events.map((e) => e.id);
    const feedback = eventIds.length ? await prisma.eventFeedback.findMany({ where: { eventId: { in: eventIds }, rating: { not: null } }, select: { rating: true } }) : [];
    const avgRating = feedback.length ? feedback.reduce((s, f) => s + f.rating, 0) / feedback.length : null;
    if (avgSellThrough === null && avgRating === null) return null;
    const sellScore = avgSellThrough !== null ? Math.min(100, avgSellThrough * 100) : null;
    const ratingScore = avgRating !== null ? (avgRating / 5) * 100 : null;
    const score = sellScore !== null && ratingScore !== null ? sellScore * 0.6 + ratingScore * 0.4 : (sellScore ?? ratingScore);
    return { score: Math.round(score), avgSellThroughRate: avgSellThrough !== null ? +(avgSellThrough * 100).toFixed(1) : null, avgRating: avgRating !== null ? +avgRating.toFixed(1) : null, feedbackCount: feedback.length };
  },

  // ---- Feedback Center ----
  async submitFeedback({ eventId, bookingId, rating, npsScore, comment }) {
    return prisma.eventFeedback.create({ data: { eventId, bookingId: bookingId || null, rating: rating ?? null, npsScore: npsScore ?? null, comment: comment || null } });
  },
  async listFeedback(eventId) {
    const rows = await prisma.eventFeedback.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } });
    const rated = rows.filter((r) => r.rating != null);
    const avgRating = rated.length ? +(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : null;
    return { entries: rows, avgRating, count: rows.length };
  },

  // ---- Organizer Goals ----
  async getGoal(organizerId, month) {
    return prisma.organizerGoal.findUnique({ where: { organizerId_month: { organizerId, month } } });
  },
  async setGoal(organizerId, month, patch) {
    return prisma.organizerGoal.upsert({
      where: { organizerId_month: { organizerId, month } },
      create: { organizerId, month, ...patch },
      update: patch,
    });
  },
  // ---- Automation Builder ----
  async listAutomationRules(organizerId, eventId) {
    return prisma.automationRule.findMany({ where: { organizerId, ...(eventId ? { eventId } : {}) }, orderBy: { createdAt: "desc" } });
  },
  async createAutomationRule({ organizerId, eventId, name, trigger, action, config }) {
    return prisma.automationRule.create({ data: { organizerId, eventId: eventId || null, name, trigger, action, config: config || {} } });
  },
  async setAutomationRuleEnabled(id, organizerId, enabled) {
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return null;
    return prisma.automationRule.update({ where: { id }, data: { enabled } });
  },
  async deleteAutomationRule(id, organizerId) {
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.automationRule.delete({ where: { id } });
    return true;
  },
  // Only "capacity_threshold" is evaluated on a scan today — the trigger/
  // action strings on the model cover more cases than are wired up yet
  // (see schema.prisma's comment), flagged honestly rather than accepting
  // rules that silently never fire.
  async dueCapacityThresholdRules() {
    const rules = await prisma.automationRule.findMany({
      where: { enabled: true, trigger: "capacity_threshold", lastRunAt: null },
      include: { event: { select: { id: true, title: true, sold: true, capacity: true, cancelled: true, ownerId: true } } },
    });
    return rules.filter((r) => {
      const e = r.event;
      if (!e || e.cancelled || !(e.capacity > 0) || e.capacity >= 9000) return false;
      const threshold = Number(r.config?.thresholdPercent) || 80;
      return (e.sold / e.capacity) * 100 >= threshold;
    });
  },
  async markAutomationRuleRun(id) {
    await prisma.automationRule.update({ where: { id }, data: { lastRunAt: new Date() } });
  },

  async goalProgress(organizerId, month) {
    const goal = await db.getGoal(organizerId, month);
    if (!goal) return { goal: null, progress: null };
    const [year, mo] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, mo - 1, 1));
    const end = new Date(Date.UTC(year, mo, 1));
    const bookings = await prisma.booking.findMany({
      where: { status: "paid", bookedAt: { gte: start, lt: end }, event: { ownerId: organizerId } },
      select: { qty: true, tier: { select: { price: true } }, event: { select: { price: true } } },
    });
    const revenue = bookings.reduce((s, b) => s + b.qty * (b.tier ? b.tier.price : b.event.price), 0);
    const attendance = bookings.reduce((s, b) => s + b.qty, 0);
    const eventsCount = await prisma.event.count({ where: { ownerId: organizerId, deletedAt: null, cancelled: false, createdAt: { gte: start, lt: end } } });
    return { goal, progress: { revenue: +revenue.toFixed(2), attendance, eventsCount } };
  },

  // Deduped by email (Booking has no userId FK — see HANDOFF.md). Anonymous
  // device-only bookers with no email are grouped under a synthetic
  // `device:<deviceId>` key rather than dropped, so their spend still counts
  // toward the organizer's totals even though they can't be identified by name.
  async organizerAttendees(userId) {
    const eventIds = await db._organizerEventIds(userId);
    if (!eventIds.length) return [];
    const bookings = await prisma.booking.findMany({
      where: { eventId: { in: eventIds }, status: "paid" },
      select: {
        eventId: true, email: true, name: true, qty: true, bookedAt: true, deviceId: true,
        tier: { select: { price: true } }, event: { select: { price: true, title: true } },
      },
      orderBy: { bookedAt: "desc" },
    });
    const byKey = new Map();
    for (const b of bookings) {
      const key = b.email ? b.email.toLowerCase() : b.deviceId ? `device:${b.deviceId}` : null;
      if (!key) continue;
      const price = b.tier ? b.tier.price : b.event.price;
      const spend = b.qty * price;
      const existing = byKey.get(key);
      if (existing) {
        existing.totalSpend += spend;
        existing.ticketsBought += b.qty;
        existing.events.add(b.eventId);
        if (new Date(b.bookedAt) > new Date(existing.lastBookedAt)) existing.lastBookedAt = b.bookedAt;
        if (!existing.name && b.name) existing.name = b.name;
      } else {
        byKey.set(key, {
          key, email: b.email || null, name: b.name || null, totalSpend: spend,
          ticketsBought: b.qty, events: new Set([b.eventId]), lastBookedAt: b.bookedAt,
        });
      }
    }
    const emails = [...byKey.values()].map((a) => a.email).filter(Boolean).map((e) => e.toLowerCase());
    const profiles = emails.length
      ? await prisma.attendeeProfile.findMany({ where: { organizerId: userId, email: { in: emails } } })
      : [];
    const profileByEmail = new Map(profiles.map((p) => [p.email.toLowerCase(), p]));
    return [...byKey.values()]
      .map((a) => {
        const p = a.email ? profileByEmail.get(a.email.toLowerCase()) : null;
        return {
          ...a, totalSpend: +a.totalSpend.toFixed(2), eventsAttended: a.events.size, events: undefined,
          tags: p?.tags || [], notes: p?.notes || "", loyaltyPoints: p?.loyaltyPoints || 0,
        };
      })
      .sort((a, b) => b.totalSpend - a.totalSpend);
  },

  // Attendee CRM: tags/notes/loyalty are per-organizer per-email, independent
  // of any single event — upserted on demand rather than requiring a
  // separate "create profile" step, since every attendee already exists
  // implicitly via their bookings (see organizerAttendees above).
  async upsertAttendeeProfile(organizerId, email, patch) {
    const data = {};
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.loyaltyPoints !== undefined) data.loyaltyPoints = patch.loyaltyPoints;
    return prisma.attendeeProfile.upsert({
      where: { organizerId_email: { organizerId, email: email.toLowerCase() } },
      create: { organizerId, email: email.toLowerCase(), ...data },
      update: data,
    });
  },

  // Revenue is derived from Booking qty × Tier/Event price (same convention
  // as dashboardSummary), not summed from Payment.amount — free events have
  // no Payment row at all, and this needs to count every ticket, not just
  // gateway-settled ones. "Fees"/"net" are the same illustrative 8%/92% split
  // already used client-side in You.tsx — there's no real payout processor
  // wired yet (see HANDOFF.md §4.5), so this is a reporting view, not a
  // ledger of actual payouts.
  async organizerFinance(userId) {
    const events = await prisma.event.findMany({
      where: { deletedAt: null, OR: [{ ownerId: userId }, { teamMembers: { some: { userId, status: "ACCEPTED" } } }] },
      select: { id: true, title: true, sold: true, price: true, tiers: { select: { sold: true, price: true } } },
    });
    const byEvent = events.map((e) => {
      const revenue = e.tiers.length ? e.tiers.reduce((s, t) => s + t.sold * t.price, 0) : e.sold * e.price;
      return { eventId: e.id, title: e.title, revenue: +revenue.toFixed(2), ticketsSold: e.sold };
    }).filter((e) => e.revenue > 0 || e.ticketsSold > 0);

    const eventIds = events.map((e) => e.id);
    const byMonth = {};
    if (eventIds.length) {
      const bookings = await prisma.booking.findMany({
        where: { eventId: { in: eventIds }, status: "paid" },
        select: { qty: true, bookedAt: true, tier: { select: { price: true } }, event: { select: { price: true } } },
      });
      for (const b of bookings) {
        const month = new Date(b.bookedAt).toISOString().slice(0, 7);
        const price = b.tier ? b.tier.price : b.event.price;
        byMonth[month] = (byMonth[month] || 0) + b.qty * price;
      }
    }
    const revenueByMonth = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue: +revenue.toFixed(2) }));

    const totalRevenue = byEvent.reduce((s, e) => s + e.revenue, 0);
    const feesPaid = +(totalRevenue * 0.08).toFixed(2);
    const expenses = await prisma.expense.findMany({ where: { organizerId: userId }, select: { amount: true } });
    const totalExpenses = +expenses.reduce((s, e) => s + e.amount, 0).toFixed(2);
    return {
      totalRevenue: +totalRevenue.toFixed(2),
      netRevenue: +(totalRevenue * 0.92).toFixed(2),
      feesPaid,
      totalExpenses,
      netProfit: +(totalRevenue * 0.92 - totalExpenses).toFixed(2),
      byEvent: byEvent.sort((a, b) => b.revenue - a.revenue),
      revenueByMonth,
      payoutsLive: false,
    };
  },

  // ---- Financial Dashboard: manually-logged costs (venue, staff, supplies…)
  // set against real ticket revenue for a real P&L, not just a sales total. ----
  async listExpenses(organizerId, eventId) {
    return prisma.expense.findMany({
      where: { organizerId, ...(eventId ? { eventId } : {}) },
      include: { event: { select: { id: true, title: true } } },
      orderBy: { date: "desc" },
    });
  },
  async createExpense({ organizerId, eventId, category, amount, note, date }) {
    return prisma.expense.create({
      data: { organizerId, eventId: eventId || null, category, amount, note: note || null, date: date || undefined },
    });
  },
  async deleteExpense(id, organizerId) {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.expense.delete({ where: { id } });
    return true;
  },

  // ---- Promotion Center: which UTM-tagged links actually drove bookings
  // for one event — "direct" buckets anything with no utm_source at all. ----
  async promotionSources(eventId) {
    const bookings = await prisma.booking.findMany({
      where: { eventId, status: { in: ["paid", "pending"] } },
      select: { qty: true, utmSource: true, utmMedium: true, utmCampaign: true, tier: { select: { price: true } } },
    });
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { price: true } });
    const bySource = new Map();
    for (const b of bookings) {
      const key = b.utmSource || "direct";
      const price = b.tier ? b.tier.price : (event?.price || 0);
      const existing = bySource.get(key) || { source: key, bookings: 0, tickets: 0, revenue: 0 };
      existing.bookings += 1;
      existing.tickets += b.qty;
      existing.revenue += b.qty * price;
      bySource.set(key, existing);
    }
    return [...bySource.values()].map((s) => ({ ...s, revenue: +s.revenue.toFixed(2) })).sort((a, b) => b.tickets - a.tickets);
  },

  // ---- File Library: URL references (own upload, Drive/Dropbox link, etc)
  // rather than a new byte-storage pipeline — organizers keep contracts/
  // riders/photos organized without this app hosting the files itself. ----
  async listMediaAssets(organizerId, eventId) {
    return prisma.mediaAsset.findMany({ where: { organizerId, ...(eventId ? { eventId } : {}) }, orderBy: { createdAt: "desc" } });
  },
  async createMediaAsset({ organizerId, eventId, url, type, folder, tags }) {
    return prisma.mediaAsset.create({ data: { organizerId, eventId: eventId || null, url, type, folder: folder || null, tags: tags || [] } });
  },
  async deleteMediaAsset(id, organizerId) {
    const existing = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.mediaAsset.delete({ where: { id } });
    return true;
  },

  // ---- Sponsor management ----
  async listSponsors(organizerId, eventId) {
    return prisma.sponsor.findMany({ where: { organizerId, ...(eventId ? { eventId } : {}) }, orderBy: { createdAt: "desc" } });
  },
  async createSponsor({ organizerId, eventId, name, contactEmail, contactPhone, contractUrl, logoUrl, amount, deliverables }) {
    return prisma.sponsor.create({ data: { organizerId, eventId: eventId || null, name, contactEmail: contactEmail || null, contactPhone: contactPhone || null, contractUrl: contractUrl || null, logoUrl: logoUrl || null, amount: amount ?? null, deliverables: deliverables || [] } });
  },
  async updateSponsor(id, organizerId, patch) {
    const existing = await prisma.sponsor.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return null;
    return prisma.sponsor.update({ where: { id }, data: patch });
  },
  async deleteSponsor(id, organizerId) {
    const existing = await prisma.sponsor.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.sponsor.delete({ where: { id } });
    return true;
  },

  // ---- Vendor management ----
  async listVendors(organizerId, eventId) {
    return prisma.vendor.findMany({ where: { organizerId, ...(eventId ? { eventId } : {}) }, orderBy: { createdAt: "desc" } });
  },
  async createVendor({ organizerId, eventId, category, name, contactEmail, contactPhone, contractUrl, paymentStatus, notes }) {
    return prisma.vendor.create({ data: { organizerId, eventId: eventId || null, category, name, contactEmail: contactEmail || null, contactPhone: contactPhone || null, contractUrl: contractUrl || null, paymentStatus: paymentStatus || "pending", notes: notes || null } });
  },
  async updateVendor(id, organizerId, patch) {
    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return null;
    return prisma.vendor.update({ where: { id }, data: patch });
  },
  async deleteVendor(id, organizerId) {
    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.vendor.delete({ where: { id } });
    return true;
  },

  // ---- Message templates (NotifyForm's "save as template") ----
  async listMessageTemplates(organizerId) {
    return prisma.messageTemplate.findMany({ where: { organizerId }, orderBy: { createdAt: "desc" } });
  },
  async createMessageTemplate({ organizerId, name, subject, message }) {
    return prisma.messageTemplate.create({ data: { organizerId, name, subject: subject || null, message } });
  },
  async deleteMessageTemplate(id, organizerId) {
    const existing = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!existing || existing.organizerId !== organizerId) return false;
    await prisma.messageTemplate.delete({ where: { id } });
    return true;
  },

  // ---- AI Studio ----
  async logAiGeneration({ organizerId, eventId, feature, prompt, output }) {
    await prisma.aiGenerationLog.create({ data: { organizerId, eventId: eventId || null, feature, prompt, output } });
  },
  // Pricing-suggestion comparables: other organizers' events, same category,
  // roughly similar capacity, that actually sold real tickets — deliberately
  // cross-organizer (this is the one AI Studio feature that needs platform-
  // wide data, not just the asking organizer's own events) but only ever
  // returns aggregates, never other organizers' identities/contact info.
  async similarEventPricing(cat, capacity) {
    const lo = Math.max(1, Math.round(capacity * 0.4));
    const hi = Math.round(capacity * 2.5);
    const events = await prisma.event.findMany({
      where: { cat, cancelled: false, deletedAt: null, capacity: { gte: lo, lte: hi }, sold: { gt: 0 } },
      select: { price: true, capacity: true, sold: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    return events;
  },

  async getOrganizerSettings(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultEventSettings: true } });
    return user?.defaultEventSettings || null;
  },
  async setOrganizerSettings(userId, settings) {
    const user = await prisma.user.update({ where: { id: userId }, data: { defaultEventSettings: settings }, select: { defaultEventSettings: true } });
    return user.defaultEventSettings;
  },

  // `advanced` (Organizer Pro's advancedAnalytics feature — see
  // server/features.js) adds views/conversionRate/check-in stats on top of
  // the same base fields every organizer already gets; free callers get
  // exactly what this returned before. conversionRate was already a
  // placeholder here (`null` — "needs page-view tracking, not yet
  // instrumented") — this fills it in using the event_view AnalyticsEvent
  // rows already recorded on every GET /api/events/:id, no new client
  // instrumentation needed. trafficSources (referrer/UTM) and
  // audienceInsights (demographic breakdown) are NOT built — there's no
  // source data for either yet; see handoff.md.
  async eventAnalytics(eventId, { advanced = false } = {}) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { tiers: true } });
    if (!event) return null;
    const bookings = await prisma.booking.findMany({ where: { eventId, status: "paid" }, select: { qty: true, tierId: true, bookedAt: true } });
    const revenue = event.tiers.length
      ? event.tiers.reduce((s, t) => s + t.sold * t.price, 0)
      : event.sold * event.price;
    const tierBreakdown = event.tiers.map((t) => ({ id: t.id, name: t.name, sold: t.sold, capacity: t.capacity, revenue: +(t.sold * t.price).toFixed(2) }));
    const salesByDay = {};
    for (const b of bookings) {
      const day = b.bookedAt.toISOString().slice(0, 10);
      salesByDay[day] = (salesByDay[day] || 0) + b.qty;
    }
    let advancedFields = { conversionRate: null };
    if (advanced) {
      const [views, tickets] = await Promise.all([
        prisma.analyticsEvent.count({ where: { type: "event_view", entityId: eventId } }),
        prisma.ticket.findMany({ where: { eventId }, select: { checkedInAt: true } }),
      ]);
      const checkedIn = tickets.filter((t) => t.checkedInAt).length;

      // Sales velocity + a naive sellout forecast: compare the last 3 days'
      // run rate against the 3 days before that, then project the remaining
      // capacity forward at the current rate. Only meaningful for a real
      // (non-"unlimited", capacity < 9000) event that isn't already sold out
      // or over.
      const now = Date.now();
      const DAY = 86400000;
      const last3 = bookings.filter((b) => now - b.bookedAt.getTime() < 3 * DAY).reduce((s, b) => s + b.qty, 0);
      const prev3 = bookings.filter((b) => { const age = now - b.bookedAt.getTime(); return age >= 3 * DAY && age < 6 * DAY; }).reduce((s, b) => s + b.qty, 0);
      const dailyRate = last3 / 3;
      const remaining = event.capacity - event.sold;
      const salesVelocity = {
        last3Days: last3, prev3Days: prev3,
        trend: prev3 > 0 ? +(((last3 - prev3) / prev3) * 100).toFixed(1) : (last3 > 0 ? 100 : 0),
      };
      const forecast = (event.capacity < 9000 && dailyRate > 0 && remaining > 0 && !event.cancelled && new Date(event.startsAt).getTime() > now)
        ? { daysToSellout: +(remaining / dailyRate).toFixed(1), projectedSelloutDate: new Date(now + (remaining / dailyRate) * DAY).toISOString() }
        : null;

      // Benchmark: this event's sell-through vs. the organizer's own average
      // across their other past events — a "compared to your usual" number
      // beats a meaningless platform-wide average with no shared context.
      const otherEvents = await prisma.event.findMany({
        where: { ownerId: event.ownerId, id: { not: eventId }, deletedAt: null, cancelled: false, capacity: { lt: 9000 } },
        select: { sold: true, capacity: true },
      });
      const sellThrough = event.capacity > 0 ? (event.sold / event.capacity) * 100 : 0;
      const avgSellThrough = otherEvents.length
        ? otherEvents.reduce((s, e) => s + (e.capacity > 0 ? e.sold / e.capacity : 0), 0) / otherEvents.length * 100
        : null;

      advancedFields = {
        views,
        conversionRate: views > 0 ? +((bookings.length / views) * 100).toFixed(1) : null,
        checkIn: { total: tickets.length, checkedIn, rate: tickets.length ? +((checkedIn / tickets.length) * 100).toFixed(1) : null },
        salesVelocity,
        forecast,
        benchmark: {
          sellThroughRate: +sellThrough.toFixed(1),
          yourAverageSellThroughRate: avgSellThrough !== null ? +avgSellThrough.toFixed(1) : null,
        },
      };
    }
    return {
      eventId,
      ticketsSold: event.sold,
      capacity: event.capacity,
      revenue: +revenue.toFixed(2),
      tierBreakdown,
      salesByDay: Object.entries(salesByDay).map(([date, qty]) => ({ date, qty })).sort((a, b) => a.date.localeCompare(b.date)),
      ...advancedFields,
    };
  },

  // ---- following (User -> organizer User, see schema.prisma's Follow comment) ----
  async followOrganizer(followerId, followingId) {
    if (followerId === followingId) throw new Error("You can't follow yourself");
    return prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });
  },
  async unfollowOrganizer(followerId, followingId) {
    await prisma.follow.deleteMany({ where: { followerId, followingId } });
  },
  async isFollowing(followerId, followingId) {
    return !!(await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } }));
  },
  async followerCount(userId) {
    return prisma.follow.count({ where: { followingId: userId } });
  },
  // Public organizer profile (see /api/organizers/:id) — deliberately
  // excludes revenue/booking data, unlike the old name-keyed
  // /api/organizer/:name/summary this replaces. Only APPROVED, non-cancelled
  // events are shown, same visibility rule as the main discovery feed.
  async getOrganizerProfile(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) return null;
    const events = await prisma.event.findMany({
      where: { ownerId: userId, deletedAt: null, cancelled: false, discoveryStatus: "APPROVED" },
      include: { tiers: true },
      orderBy: { startsAt: "asc" },
    });
    const settings = user.defaultEventSettings || {};
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: settings.bio || null,
      instagram: settings.instagram || null,
      website: settings.website || null,
      followerCount: await db.followerCount(userId),
      events: events.map(shape),
    };
  },
  async followingIds(userId) {
    const rows = await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
    return rows.map((r) => r.followingId);
  },
  // events from organizers the user follows, soonest first — the actual
  // payoff of the follow graph, not just a follower-count vanity metric
  async followingFeed(userId) {
    const ids = await db.followingIds(userId);
    if (!ids.length) return [];
    const events = await prisma.event.findMany({
      // inviteOnly excluded — this is a discovery-style feed, same rule as
      // GET /api/events; an invite-only event should only ever be reached
      // via its direct link, never surfaced through a listing.
      where: { ownerId: { in: ids }, deletedAt: null, cancelled: false, inviteOnly: false, startsAt: { gte: new Date() } },
      include: { tiers: true },
      orderBy: { startsAt: "asc" },
    });
    return events.map(shape);
  },

  // ---- collections (Pinterest-style saved lists, see schema.prisma) ----
  async createCollection(ownerId, name) {
    return prisma.collection.create({ data: { ownerId, name: name.trim().slice(0, 60) } });
  },
  async listMyCollections(ownerId) {
    return prisma.collection.findMany({
      where: { ownerId },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    });
  },
  // viewerId strips inviteCode from any invite-only event the viewer
  // doesn't own — a collection (unlike the discovery listing) is allowed to
  // contain an invite-only event (e.g. saving one you were personally
  // invited to), but saving it must not leak the secret code to anyone else
  // who opens the same (possibly public) collection.
  async getCollection(id, viewerId = null) {
    const c = await prisma.collection.findUnique({
      where: { id },
      include: { items: { include: { event: { include: { tiers: true } } }, orderBy: { addedAt: "desc" } }, owner: { select: { id: true, name: true } } },
    });
    if (!c) return null;
    const events = c.items.map((i) => {
      const e = shape(i.event);
      if (e.inviteOnly && e.ownerId !== viewerId) {
        const { inviteCode, ...safe } = e;
        return safe;
      }
      return e;
    });
    return { id: c.id, name: c.name, isPublic: c.isPublic, ownerId: c.ownerId, ownerName: c.owner.name, events };
  },
  async renameCollection(id, name) {
    return prisma.collection.update({ where: { id }, data: { name: name.trim().slice(0, 60) } });
  },
  async deleteCollection(id) {
    await prisma.collection.delete({ where: { id } });
  },
  async addToCollection(collectionId, eventId) {
    return prisma.collectionItem.upsert({
      where: { collectionId_eventId: { collectionId, eventId } },
      create: { collectionId, eventId },
      update: {},
    });
  },
  async removeFromCollection(collectionId, eventId) {
    await prisma.collectionItem.deleteMany({ where: { collectionId, eventId } });
  },

  // ---- search (Postgres full-text + trigram, see migration's weyn_event_tsvector) ----
  async searchEvents(query, { cat, limit = 40 } = {}) {
    const q = query.trim();
    if (!q) return db.all();
    // plainto_tsquery handles multi-word queries safely (no injection risk —
    // it's a parameter, not concatenated SQL); ts_rank_cd for relevance,
    // OR'd with a trigram similarity fallback so single-typo queries
    // ("jaz" for "jazz") still surface results a strict FTS match would miss
    const rows = await prisma.$queryRaw`
      SELECT e.*, ts_rank_cd(weyn_event_tsvector(e.title, e.organizer, e.venue, e.blurb, e.tags), plainto_tsquery('english', ${q})) AS rank
      FROM "Event" e
      WHERE e."deletedAt" IS NULL
        AND e."discoveryStatus" = 'APPROVED'
        AND e."inviteOnly" = false
        AND (
          weyn_event_tsvector(e.title, e.organizer, e.venue, e.blurb, e.tags) @@ plainto_tsquery('english', ${q})
          OR similarity(e.organizer, ${q}) > 0.3
          OR similarity(e.venue, ${q}) > 0.3
        )
        ${cat && cat !== "all" ? Prisma.sql`AND e.cat = ${cat}` : Prisma.empty}
      ORDER BY rank DESC, e."startsAt" ASC
      LIMIT ${limit}
    `;
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const tiers = await prisma.tier.findMany({ where: { eventId: { in: ids } } });
    const tiersByEvent = {};
    for (const t of tiers) (tiersByEvent[t.eventId] ||= []).push(t);
    // preserve the rank-sorted order from the raw query — Prisma's findMany
    // WHERE IN doesn't guarantee it
    return rows.map((r) => shape({ ...r, tiers: tiersByEvent[r.id] || [] }));
  },

  // ---- event quality score (discovery ranking signal, see audit notes) ----
  // Deliberately computed, not stored — cheap over a few thousand rows and
  // always reflects current sold/save counts without a background job to
  // keep a column in sync.
  eventQualityScore(e) {
    let score = 0;
    if (e.image) score += 30;
    if (e.blurb && e.blurb.length > 60) score += 15;
    if (e.tags && e.tags.length > 0) score += 10;
    const capacityKnown = e.capacity < 9000;
    if (capacityKnown && e.capacity > 0) score += Math.min(30, (e.sold / e.capacity) * 30);
    if (e.organizerVerified) score += 15;
    return Math.round(score);
  },

  // ---- reports (moderation queue, see schema.prisma's Report comment) ----
  async createReport({ reporterId, entityType, entityId, reason, note }) {
    return prisma.report.create({ data: { reporterId, entityType, entityId, reason, note: note?.slice(0, 500) || null } });
  },
  async listOpenReports() {
    return prisma.report.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, include: { reporter: { select: { name: true, email: true } } } });
  },
  async resolveReport(id, reviewerId, status) {
    return prisma.report.update({ where: { id }, data: { status, reviewedBy: reviewerId, reviewedAt: new Date() } });
  },

  // ---- admin platform metrics ----
  async platformMetrics() {
    const [totalUsers, totalEvents, totalBookings, openReports, revenueRows] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.event.count({ where: { deletedAt: null } }),
      prisma.booking.count({ where: { status: "paid" } }),
      prisma.report.count({ where: { status: "OPEN" } }),
      prisma.$queryRaw`SELECT COALESCE(SUM(p.amount), 0)::float AS total FROM "Payment" p WHERE p.status = 'paid'`,
    ]);
    const sevenDaysAgo = new Date(Date.now() - 7 * 864e5);
    const newUsersThisWeek = await prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } });
    const newEventsThisWeek = await prisma.event.count({ where: { createdAt: { gte: sevenDaysAgo } } });
    return {
      totalUsers, totalEvents, totalBookings, openReports,
      totalRevenue: revenueRows[0]?.total || 0,
      newUsersThisWeek, newEventsThisWeek,
    };
  },

  // ---- trust & safety (see server/moderation.js) ----
  async recordModeration(eventId, result) {
    await prisma.$transaction([
      prisma.moderationResult.create({ data: { eventId, ...result } }),
      prisma.event.update({ where: { id: eventId }, data: { discoveryStatus: result.resultingStatus } }),
    ]);
  },
  // Events waiting on a human — MANUAL_REVIEW only (DISCOVERY_LIMITED events
  // aren't queued, they're just quietly reach-limited forever unless
  // re-scored, per the design's "don't force sloppy-but-honest organizers
  // through a review queue" principle).
  async listReviewQueue() {
    const events = await prisma.event.findMany({
      where: { discoveryStatus: "MANUAL_REVIEW", deletedAt: null },
      include: {
        tiers: true,
        moderationResults: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" }, // oldest-queued first — simple FIFO for the MVP, priority scoring is a scale-version concern
    });
    return events.map(({ moderationResults, ...e }) => ({ ...shape(e), latestModeration: moderationResults[0] || null }));
  },
  async resolveModeration(eventId, status, reviewerId) {
    const updated = await prisma.event.update({ where: { id: eventId }, data: { discoveryStatus: status } });
    await db.audit("event.moderation.resolve", { actorId: reviewerId, entityType: "event", entityId: eventId, metadata: { status } });
    return shape(updated);
  },
};
