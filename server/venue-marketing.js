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
