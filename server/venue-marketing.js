// Venue-guest audience segmentation for Marketing campaigns — shared by
// the send-now route, the scheduled-campaign scanner, and the preview
// endpoint, so all three always agree on who a segment actually resolves
// to. Reuses real reservation history and VenueGuestNote tags; never a
// fabricated or cached audience.
import { prisma } from "./db.js";

// segment: { type: "all" | "tag" | "inactive" | "new", tag?: string, days?: number }
export async function resolveVenueSegment(venueId, segment) {
  const type = segment?.type || "all";
  const reservations = await prisma.reservation.findMany({
    where: { venueId, status: { not: "cancelled" } },
    select: { guestEmail: true, guestName: true, date: true },
    orderBy: { date: "desc" },
  });

  const byEmail = new Map();
  for (const r of reservations) {
    const key = r.guestEmail.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.visits += 1;
      if (new Date(r.date) > new Date(existing.lastVisit)) existing.lastVisit = r.date;
    } else {
      byEmail.set(key, { email: r.guestEmail, name: r.guestName, visits: 1, lastVisit: r.date });
    }
  }
  let guests = [...byEmail.values()];

  if (type === "tag") {
    const tag = String(segment?.tag || "").trim();
    if (!tag) return [];
    const notes = await prisma.venueGuestNote.findMany({ where: { venueId, tags: { has: tag } }, select: { guestEmail: true } });
    const tagged = new Set(notes.map((n) => n.guestEmail.toLowerCase()));
    guests = guests.filter((g) => tagged.has(g.email.toLowerCase()));
  } else if (type === "inactive") {
    const days = Math.max(1, Number(segment?.days) || 60);
    const cutoff = Date.now() - days * 86400000;
    guests = guests.filter((g) => new Date(g.lastVisit).getTime() < cutoff);
  } else if (type === "new") {
    guests = guests.filter((g) => g.visits === 1);
  }
  // type === "all": no further filtering

  return guests;
}

// ---- Loyalty tiers ----
// Simple, fixed visit-count thresholds — no payment/discount processing,
// just a badge shown in the guest CRM. Kept as plain constants (not a
// per-venue setting) so "gold" means the same thing everywhere, same
// reasoning as why this isn't a configurable points system.
export const LOYALTY_TIERS = [
  { key: "gold", label: "Gold", minVisits: 6 },
  { key: "silver", label: "Silver", minVisits: 3 },
  { key: "bronze", label: "Bronze", minVisits: 1 },
];

export function loyaltyTierForVisits(visits) {
  for (const t of LOYALTY_TIERS) {
    if (visits >= t.minVisits) return t.key;
  }
  return null;
}

// Live visit counts per guest for a venue — the same computation
// resolveVenueSegment does internally, exposed standalone since the
// loyalty view needs it independent of any segment filter.
export async function venueGuestVisitCounts(venueId) {
  const reservations = await prisma.reservation.findMany({
    where: { venueId, status: { not: "cancelled" } },
    select: { guestEmail: true, guestName: true, date: true },
    orderBy: { date: "desc" },
  });
  const byEmail = new Map();
  for (const r of reservations) {
    const key = r.guestEmail.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.visits += 1;
      if (new Date(r.date) > new Date(existing.lastVisit)) existing.lastVisit = r.date;
    } else {
      byEmail.set(key, { email: r.guestEmail, name: r.guestName, visits: 1, lastVisit: r.date });
    }
  }
  return [...byEmail.values()];
}

// Win-back conversion: of the guests a campaign was sent to (see
// VenueCampaignRecipient), how many made a new (non-cancelled) reservation
// within `windowDays` after the campaign actually sent. A guest converts at
// most once per campaign regardless of how many reservations they make in
// the window.
export async function winBackConversion(venueId, campaign, recipients, windowDays = 30) {
  if (!campaign.sentAt || recipients.length === 0) return { targeted: recipients.length, converted: 0, rate: null };
  const windowEnd = new Date(campaign.sentAt.getTime() + windowDays * 86400000);
  const emails = recipients.map((r) => r.guestEmail.toLowerCase());
  const followUps = await prisma.reservation.findMany({
    where: {
      venueId,
      status: { not: "cancelled" },
      createdAt: { gt: campaign.sentAt, lte: windowEnd },
    },
    select: { guestEmail: true },
  });
  const bookedAgain = new Set(followUps.map((r) => r.guestEmail.toLowerCase()));
  const converted = emails.filter((e) => bookedAgain.has(e)).length;
  return { targeted: recipients.length, converted, rate: recipients.length ? converted / recipients.length : null, windowDays };
}
