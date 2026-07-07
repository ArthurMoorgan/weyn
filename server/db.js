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
        accessToken: crypto.randomBytes(24).toString("base64url"),
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
  async createTeamInvite({ eventId, invitedEmail, role, invitedBy }) {
    return prisma.eventTeamMember.create({
      data: { eventId, invitedEmail: invitedEmail.toLowerCase().trim(), role, invitedBy },
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
      advancedFields = {
        views,
        conversionRate: views > 0 ? +((bookings.length / views) * 100).toFixed(1) : null,
        checkIn: { total: tickets.length, checkedIn, rate: tickets.length ? +((checkedIn / tickets.length) * 100).toFixed(1) : null },
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
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
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
      where: { ownerId: { in: ids }, deletedAt: null, cancelled: false, startsAt: { gte: new Date() } },
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
  async getCollection(id) {
    const c = await prisma.collection.findUnique({
      where: { id },
      include: { items: { include: { event: { include: { tiers: true } } }, orderBy: { addedAt: "desc" } }, owner: { select: { id: true, name: true } } },
    });
    if (!c) return null;
    return { id: c.id, name: c.name, isPublic: c.isPublic, ownerId: c.ownerId, ownerName: c.owner.name, events: c.items.map((i) => shape(i.event)) };
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
