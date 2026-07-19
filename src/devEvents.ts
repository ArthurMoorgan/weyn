// Dev-only mock events. Used ONLY as a fallback when the events API is
// unreachable or returns nothing AND import.meta.env.DEV is true (see
// api.ts listEvents). In a production build `import.meta.env.DEV` is a
// compile-time false, so this whole module is tree-shaken out of the bundle
// — it can never fake events on the live site, only populate an offline
// dev/preview run so the spotlight, feed, and scroll can be exercised.
import type { Weyn } from "./api";

function iso(dayOffset: number, hour: number, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

type Seed = Omit<Weyn, "endsAt" | "cancelled" | "ticketingType" | "externalTicketUrl" | "organizerContact"> &
  Partial<Pick<Weyn, "endsAt" | "featured">>;

const RAW: Seed[] = [
  { id: "dev-street-food", title: "Mutrah Night Food Market", organizer: "Mutrah Collective", cat: "food", startsAt: iso(0, 18), venue: "Mutrah Corniche", area: "Mutrah", lat: 23.62, lng: 58.57, distanceKm: 4.8, price: 0, capacity: 999, sold: 240, image: null, color: "#B5562F", glyph: "🍢", blurb: "Twenty stalls along the water — shawarma, grilled hammour, karak, and Omani halwa.", tags: ["outdoor", "family-friendly"], refundPolicy: "Free entry", minAge: 0, featured: true },
  { id: "dev-indie", title: "Desert Sessions: Live", organizer: "Wadi Sound", cat: "music", startsAt: iso(8, 20), venue: "Amphitheatre, Al Mouj", area: "Al Mouj", lat: 23.61, lng: 58.28, distanceKm: 3.6, price: 20, capacity: 1200, sold: 940, image: null, color: "#3E2B54", glyph: "🎸", blurb: "Three indie acts under the open sky. Food trucks from 6pm.", tags: ["outdoor", "16+"], refundPolicy: "Refund up to 7 days before", minAge: 16, featured: true },
  { id: "dev-food-fest", title: "Muscat Food Festival 2026", organizer: "Visit Muscat", cat: "food", startsAt: iso(12, 15), venue: "Al Amerat Park", area: "Al Amerat", lat: 23.52, lng: 58.50, distanceKm: 14, price: 3, capacity: 5000, sold: 1180, image: null, color: "#8A4B2B", glyph: "🍽", blurb: "Three days, eighty vendors, a chef stage, and a kids' zone.", tags: ["family-friendly", "weekend"], refundPolicy: "Refund up to 7 days before", minAge: 0, featured: true },
  { id: "dev-marathon", title: "Corniche Half Marathon", organizer: "Run Oman", cat: "sports", startsAt: iso(10, 5, 30), venue: "Mutrah Corniche start line", area: "Mutrah", lat: 23.62, lng: 58.57, distanceKm: 4.9, price: 8, capacity: 2000, sold: 1320, image: null, color: "#1F5E63", glyph: "🏃", blurb: "21km along the water before the heat. Chip timing, finisher medal.", tags: ["outdoor", "registration"], refundPolicy: "No refunds", minAge: 16, featured: true },
  { id: "dev-boxing", title: "Muscat Fight Night III", organizer: "Gulf Combat Club", cat: "sports", startsAt: iso(0, 20), venue: "Al Mouj Arena", area: "Al Mouj", lat: 23.61, lng: 58.28, distanceKm: 3.4, price: 12, capacity: 400, sold: 362, image: null, color: "#2A2E45", glyph: "🥊", blurb: "Eight amateur bouts, a title fight, and the loudest crowd in the city.", tags: ["18+", "indoor"], refundPolicy: "No refunds within 24h", minAge: 16 },
  { id: "dev-oud", title: "Oud & Coffee on the Roof", organizer: "Bait Al Zubair", cat: "music", startsAt: iso(0, 21, 30), venue: "Old Muscat rooftop", area: "Old Muscat", lat: 23.61, lng: 58.59, distanceKm: 6.1, price: 5, capacity: 60, sold: 48, image: null, color: "#2F5D52", glyph: "🎶", blurb: "Live oud under the stars with cardamom coffee and dates.", tags: ["acoustic", "outdoor"], refundPolicy: "Refund up to 48h before", minAge: 0 },
  { id: "dev-jazz", title: "Jazz Supper Club", organizer: "The Cellar", cat: "music", startsAt: iso(1, 22), venue: "The Cellar, Shatti", area: "Shatti Al Qurum", lat: 23.61, lng: 58.48, distanceKm: 2.2, price: 9, capacity: 50, sold: 44, image: null, color: "#2C3350", glyph: "🎷", blurb: "A trio, low light, and a short menu. Late seating only.", tags: ["indoor", "21+"], refundPolicy: "No refunds", minAge: 21 },
  { id: "dev-pottery", title: "Beginner Pottery Wheel", organizer: "Clay House Studio", cat: "workshop", startsAt: iso(1, 11), venue: "Clay House, Azaiba", area: "Azaiba", lat: 23.59, lng: 58.42, distanceKm: 7.2, price: 18, capacity: 10, sold: 6, image: null, color: "#7A5230", glyph: "🏺", blurb: "Two hours on the wheel, all clay and tools included.", tags: ["beginner", "indoor"], refundPolicy: "Refund up to 24h before", minAge: 12 },
  { id: "dev-car", title: "Friday JDM Car Meet", organizer: "Muscat Auto Scene", cat: "community", startsAt: iso(3, 18, 30), venue: "Qurum Beach car park", area: "Qurum", lat: 23.61, lng: 58.48, distanceKm: 5, price: 0, capacity: 999, sold: 130, image: null, color: "#3A4668", glyph: "🚗", blurb: "Skylines, Supras, and a few surprises. Coffee truck on site.", tags: ["outdoor", "free"], refundPolicy: "Free entry", minAge: 0 },
  { id: "dev-uni", title: "SQU Spring Culture Fest", organizer: "SQU Student Union", cat: "culture", startsAt: iso(6, 16), venue: "Sultan Qaboos University", area: "Al Khoudh", lat: 23.59, lng: 58.17, distanceKm: 11.3, price: 2, capacity: 800, sold: 210, image: null, color: "#6B3F5B", glyph: "🎏", blurb: "Food from twelve countries, a poetry stage, henna, and a night market.", tags: ["family-friendly", "outdoor"], refundPolicy: "Refund up to 7 days before", minAge: 0 },
  { id: "dev-beach", title: "Sunrise Beach Cleanup + Yoga", organizer: "Green Muscat", cat: "community", startsAt: iso(5, 6), venue: "Yiti Beach", area: "Yiti", lat: 23.54, lng: 58.65, distanceKm: 18.4, price: 0, capacity: 80, sold: 52, image: null, color: "#4A6B52", glyph: "🌅", blurb: "Gloves and bags provided. Stay for a free sunrise yoga flow and karak.", tags: ["outdoor", "wellness"], refundPolicy: "Free entry", minAge: 0 },
  { id: "dev-comedy", title: "Standup Night: Open Mic", organizer: "Muscat Comedy Cellar", cat: "culture", startsAt: iso(2, 21), venue: "The Loft, Ghubra", area: "Al Ghubra", lat: 23.59, lng: 58.44, distanceKm: 6.4, price: 6, capacity: 90, sold: 61, image: null, color: "#514063", glyph: "🎤", blurb: "Ten comics, five minutes each, one very brave headliner.", tags: ["indoor", "18+"], refundPolicy: "No refunds", minAge: 18 },
  { id: "dev-tech", title: "Founders & Coffee Meetup", organizer: "Oman Startup Hub", cat: "workshop", startsAt: iso(4, 9), venue: "Innovation Hub, KOM", area: "Knowledge Oasis", lat: 23.58, lng: 58.28, distanceKm: 12.1, price: 0, capacity: 120, sold: 74, image: null, color: "#2E4A5A", glyph: "☕", blurb: "Casual morning meetup for founders, builders, and the merely curious.", tags: ["networking", "free"], refundPolicy: "Free entry", minAge: 16 },
  { id: "dev-film", title: "Open-Air Film: Classics", organizer: "Reel Muscat", cat: "culture", startsAt: iso(7, 19, 30), venue: "Qurum Natural Park", area: "Qurum", lat: 23.61, lng: 58.49, distanceKm: 5.3, price: 4, capacity: 300, sold: 118, image: null, color: "#3B3252", glyph: "🎬", blurb: "Bring a blanket. A restored classic on a huge inflatable screen under the stars.", tags: ["outdoor", "family-friendly"], refundPolicy: "Refund up to 24h before", minAge: 0 },
];

export function devEvents(): Weyn[] {
  return RAW.map((e) => ({
    endsAt: null,
    cancelled: false,
    ticketingType: "weyn",
    externalTicketUrl: null,
    organizerContact: null,
    ...e,
  })) as Weyn[];
}
