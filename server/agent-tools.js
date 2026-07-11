// The agentic AI assistant's tool registry (Phase 1 — see You/Organizer AI
// Studio's chat). Every tool wraps an operation that ALREADY exists as a
// route elsewhere in this app; the model never sees or writes SQL, and
// every executor re-validates ownership against the real DB regardless of
// what id the model supplies as an argument — the model's own arguments are
// never trusted as proof of access, exactly like every other route in this
// app treats client input.
//
// `mutates: false` tools run immediately during the chat turn (see
// buildToolExecutor's fast path) — they only ever read data.
// `mutates: true` tools NEVER run during the chat turn. Instead an
// AgentAction row is created with status "proposed" and the tool's real
// `execute` only ever runs from POST /api/organizer/ai/actions/:id/approve,
// after the owner has explicitly reviewed the exact arguments and the
// model's stated reasoning. This is the whole point of the approval system
// — see prisma/schema.prisma's AgentAction comment.
import { prisma } from "./db.js";
import { db } from "./db.js";
import { sendEmail } from "./email.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Venues owned by this user — every venue-scoped tool re-derives this
// itself rather than trusting a venueId the model supplies to already be
// theirs.
async function ownedVenueIds(userId) {
  const venues = await prisma.venue.findMany({ where: { ownerId: userId }, select: { id: true } });
  return venues.map((v) => v.id);
}

async function assertOwnsVenue(userId, venueId) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue || venue.ownerId !== userId) throw new Error("You don't manage that venue.");
  return venue;
}

async function assertOwnsEvent(userId, eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.ownerId !== userId) throw new Error("You don't manage that event.");
  return event;
}

const REASONING_PARAM = { type: "STRING", description: "Briefly explain, in one sentence, why you're proposing this specific action — shown to the owner before they approve it." };

export const AGENT_TOOLS = [
  {
    name: "getUpcomingReservations",
    description: "List upcoming venue reservations for the organizer, optionally filtered to one venue.",
    mutates: false,
    parameters: {
      type: "OBJECT",
      properties: {
        venueId: { type: "STRING", description: "Optional — limit to one venue's reservations" },
        days: { type: "INTEGER", description: "How many days ahead to look. Default 7." },
      },
    },
    async execute(args, { userId }) {
      const venueIds = args.venueId ? [(await assertOwnsVenue(userId, args.venueId)).id] : await ownedVenueIds(userId);
      if (!venueIds.length) return { reservations: [], note: "No venues owned by this organizer." };
      const days = Math.min(60, Math.max(1, Number(args.days) || 7));
      const now = new Date();
      const until = new Date(now.getTime() + days * 86400000);
      const rows = await prisma.reservation.findMany({
        where: { venueId: { in: venueIds }, date: { gte: now, lte: until }, status: { in: ["pending", "confirmed"] } },
        orderBy: [{ date: "asc" }],
        take: 50,
        select: { id: true, venueId: true, guestName: true, partySize: true, date: true, time: true, status: true },
      });
      return { reservations: rows };
    },
  },
  {
    name: "getRevenue",
    description: "Get the organizer's ticket revenue summary across all their events — total, net, by event, by month.",
    mutates: false,
    parameters: { type: "OBJECT", properties: {} },
    async execute(_args, { userId }) {
      return db.organizerFinance(userId);
    },
  },
  {
    name: "getCustomerHistory",
    description: "Look up one customer's history by email — ticket purchases and venue reservations.",
    mutates: false,
    parameters: {
      type: "OBJECT",
      properties: { email: { type: "STRING", description: "The customer's email address" } },
      required: ["email"],
    },
    async execute(args, { userId }) {
      const email = String(args.email || "").trim().toLowerCase();
      if (!email) throw new Error("email is required");
      const attendees = await db.organizerAttendees(userId);
      const ticketHistory = attendees.find((a) => (a.email || "").toLowerCase() === email) || null;
      const venueIds = await ownedVenueIds(userId);
      const reservations = venueIds.length
        ? await prisma.reservation.findMany({ where: { venueId: { in: venueIds }, guestEmail: { equals: email, mode: "insensitive" } }, orderBy: { date: "desc" } })
        : [];
      return { email, ticketHistory, reservations };
    },
  },
  {
    name: "findAvailableTables",
    description: "Find tables at a venue that are free for a given date and party size.",
    mutates: false,
    parameters: {
      type: "OBJECT",
      properties: {
        venueId: { type: "STRING" },
        date: { type: "STRING", description: "YYYY-MM-DD" },
        partySize: { type: "INTEGER" },
      },
      required: ["venueId", "date", "partySize"],
    },
    async execute(args, { userId }) {
      await assertOwnsVenue(userId, args.venueId);
      const plan = await prisma.floorPlan.findUnique({ where: { venueId: args.venueId }, include: { tables: true } });
      if (!plan) return { tables: [], note: "This venue has no floor plan set up yet." };
      const partySize = Number(args.partySize) || 1;
      const dayStart = new Date(args.date); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
      const assigned = await prisma.tableAssignmentTable.findMany({
        where: {
          tableId: { in: plan.tables.map((t) => t.id) },
          assignment: { date: { gte: dayStart, lt: dayEnd }, reservation: { status: { in: ["pending", "confirmed", "seated"] } } },
        },
        select: { tableId: true },
      });
      const takenIds = new Set(assigned.map((a) => a.tableId));
      const available = plan.tables.filter((t) => t.status === "available" && !takenIds.has(t.id) && t.maxCapacity >= partySize && t.minCapacity <= partySize);
      return { tables: available.map((t) => ({ id: t.id, label: t.label, minCapacity: t.minCapacity, maxCapacity: t.maxCapacity })) };
    },
  },
  {
    name: "assignTable",
    description: "Assign one or more tables to an existing reservation (merge = multiple tableIds). Requires owner approval before it takes effect.",
    mutates: true,
    parameters: {
      type: "OBJECT",
      properties: {
        reservationId: { type: "STRING" },
        tableIds: { type: "ARRAY", items: { type: "STRING" } },
        reasoning: REASONING_PARAM,
      },
      required: ["reservationId", "tableIds", "reasoning"],
    },
    async execute(args, { userId }) {
      const reservation = await prisma.reservation.findUnique({ where: { id: args.reservationId }, include: { venue: true } });
      if (!reservation || reservation.venue.ownerId !== userId) throw new Error("You don't manage that reservation's venue.");
      const tableIds = Array.isArray(args.tableIds) ? args.tableIds : [];
      if (!tableIds.length) throw new Error("tableIds is required");
      const tables = await prisma.floorTable.findMany({ where: { id: { in: tableIds } }, include: { floorPlan: true } });
      if (tables.length !== tableIds.length || tables.some((t) => t.floorPlan.venueId !== reservation.venueId)) {
        throw new Error("Invalid table(s) for this venue.");
      }
      const saved = await prisma.tableAssignment.upsert({
        where: { reservationId: reservation.id },
        create: { reservationId: reservation.id, date: reservation.date, time: reservation.time, partySize: reservation.partySize, tables: { create: tableIds.map((tableId) => ({ tableId })) } },
        update: { tables: { deleteMany: {}, create: tableIds.map((tableId) => ({ tableId })) } },
        include: { tables: { include: { table: true } } },
      });
      return { assignmentId: saved.id, tables: saved.tables.map((t) => t.table.label) };
    },
  },
  {
    name: "createReservation",
    description: "Create a new reservation for a venue (e.g. a phone booking). Requires owner approval before it takes effect.",
    mutates: true,
    parameters: {
      type: "OBJECT",
      properties: {
        venueId: { type: "STRING" },
        guestName: { type: "STRING" },
        guestEmail: { type: "STRING" },
        partySize: { type: "INTEGER" },
        date: { type: "STRING", description: "YYYY-MM-DD" },
        time: { type: "STRING", description: "HH:mm" },
        notes: { type: "STRING" },
        reasoning: REASONING_PARAM,
      },
      required: ["venueId", "guestName", "guestEmail", "partySize", "date", "time", "reasoning"],
    },
    async execute(args, { userId }) {
      await assertOwnsVenue(userId, args.venueId);
      const reservation = await prisma.reservation.create({
        data: {
          venueId: args.venueId, guestName: String(args.guestName), guestEmail: String(args.guestEmail),
          partySize: Math.max(1, Number(args.partySize) || 1), date: new Date(args.date), time: String(args.time),
          notes: args.notes ? String(args.notes) : null, status: "confirmed", source: "manual",
        },
      });
      return { reservationId: reservation.id };
    },
  },
  {
    name: "sendCampaignEmail",
    description: "Send a marketing/update email to everyone with a paid ticket to one of the organizer's events. Requires owner approval before it sends.",
    mutates: true,
    parameters: {
      type: "OBJECT",
      properties: {
        eventId: { type: "STRING" },
        subject: { type: "STRING" },
        message: { type: "STRING" },
        reasoning: REASONING_PARAM,
      },
      required: ["eventId", "subject", "message", "reasoning"],
    },
    async execute(args, { userId }) {
      const event = await assertOwnsEvent(userId, args.eventId);
      const bookings = await prisma.booking.findMany({ where: { eventId: event.id, status: "paid" }, select: { email: true } });
      const subject = String(args.subject), message = String(args.message);
      const safeSubject = escapeHtml(subject), safeMessage = escapeHtml(message), safeTitle = escapeHtml(event.title);
      let emailed = 0;
      await Promise.all(bookings.filter((b) => b.email).map((b) =>
        sendEmail({
          to: b.email,
          subject: `${event.title}: ${subject}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you have a ticket to ${safeTitle}.</p></div>`,
        }).then(() => emailed++).catch(() => {})
      ));
      await db.createCampaign({ organizerId: userId, eventId: event.id, subject, message, scheduledFor: null });
      await db.audit("event.notify", { actorId: userId, entityType: "event", entityId: event.id, metadata: { subject, emailed, via: "agent" } });
      return { recipients: bookings.length, emailed };
    },
  },
];

export function toolByName(name) {
  return AGENT_TOOLS.find((t) => t.name === name);
}

// Used as runAgentTurn's `executeTool` during a live chat turn — read-only
// tools run for real immediately; mutating tools never touch the database
// here, they only ever create the approval-queue row.
export function buildToolExecutor(userId) {
  return async function executeTool(name, args) {
    const tool = toolByName(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    if (!tool.mutates) {
      try {
        return await tool.execute(args, { userId });
      } catch (err) {
        return { error: err.message || String(err) };
      }
    }
    const action = await prisma.agentAction.create({
      data: { organizerId: userId, tool: name, args, reasoning: String(args.reasoning || "") },
    });
    return { proposed: true, actionId: action.id, status: "proposed", note: "This action requires the owner's approval and has NOT been executed yet." };
  };
}
