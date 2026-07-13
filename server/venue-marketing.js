// Venue-guest audience segmentation for Marketing campaigns — shared by
// the send-now route, the scheduled-campaign scanner, and the preview
// endpoint, so all three always agree on who a segment actually resolves
// to. Reuses real reservation history and VenueGuestNote tags; never a
// fabricated or cached audience.
import { prisma } from "./db.js";
import { aiConfigured, askClaudeJson } from "./ai.js";
import { PERSUASION_ANGLE_KEYS, brandKitLine } from "./marketing.js";

export { PERSUASION_ANGLE_KEYS };

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

// ---- Growth tools: venue-flavored equivalents of server/marketing.js's
// generateGrowthIdeas/generateAngledCopy/generateBulkAdVariants/
// generateFreeToolIdeas. Deliberately NOT calling those functions directly
// — they're built around an Event object's shape (title/startsAt/price/
// ticketingType/capacity/sold), which a Venue doesn't have (a venue is a
// standing place with recurring availability, not a one-off scheduled
// happening, per prisma/schema.prisma's Venue comment) — but they DO
// reuse the same aiConfigured()/askClaudeJson() plumbing and the same
// PERSUASION_ANGLE_KEYS angle vocabulary (re-exported above) so the two
// dashboards' "angle" dropdowns mean the same thing. Same ephemeral,
// no-persistence, template-fallback-when-no-AI-key contract as the
// organizer versions. ----

const VENUE_PERSUASION_ANGLES = {
  scarcity: "scarcity (limited tables/capacity for the promoted night — only true if it's actually plausible, never invent a specific number that isn't given)",
  social_proof: "social proof (this venue is popular/well-loved/talked about — phrase generically, e.g. 'one of the most-booked spots in the area', never invent a specific stat or testimonial that isn't given)",
  urgency: "urgency/FOMO (the promoted window — happy hour, a themed night, a booking deadline — is closing soon)",
  exclusivity: "exclusivity (this is a special, limited, insider kind of experience at this venue, not an everyday visit)",
};

function venueLine(venue) {
  return `${venue.name}, a ${String(venue.category || "").replace("_", " ")} in ${venue.area}, Oman. ${venue.description || ""}`.trim();
}

export async function generateVenueGrowthIdeas(venue) {
  const fallback = [
    { title: "Partner with a nearby event", description: `Offer a discount or shoutout to attendees of events happening near ${venue.venue || venue.name} in ${venue.area} — foot traffic already headed to the area converts better than cold ads.` },
    { title: "Slow-night promotion", description: "Pick your quietest recurring night and run a real, time-boxed promotion (happy hour, set menu, live music) — a genuine reason to come on an off-night, not a blanket discount every day." },
    { title: "Local community tie-in", description: `Post in ${venue.area}-focused Facebook/WhatsApp community groups with a real photo and story, not just a flyer.` },
    { title: "Loyalty-tier shoutout", description: "Message your Gold/Silver-tier regulars (see the Loyalty tab) directly about an upcoming night — personal asks convert far better than public posts." },
    { title: "Referral push", description: "Remind recent guests they have a referral code (see Loyalty) and what it's worth to bring a friend." },
  ];
  if (!aiConfigured()) return fallback;
  const prompt = `You are a tactical growth marketer helping a real, physical venue (restaurant/cafe/lounge/rooftop/beach club/experience venue) fill more tables and get repeat guests. Given this specific venue, suggest 5 to 8 CONCRETE, TACTICAL growth ideas — not generic advice like "use social media". Think: partnership angles with nearby events/businesses, slow-night promotions, local community tie-ins specific to the area given, and loyalty/referral tactics. Every idea must be something the owner could literally go do this week. Do not invent facts about this venue not given below.
Return STRICT JSON: an array of objects {"title":"short punchy title","description":"1-2 sentences, concrete and specific to this venue"}.

Venue: ${venueLine(venue)}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 1200 });
    const ideas = Array.isArray(result) ? result : (result.ideas || []);
    if (ideas.length) return ideas.slice(0, 8);
  } catch {
    // fall through to the static fallback below
  }
  return fallback;
}

export async function generateVenueAngledCopy(venue, brandKit, angle) {
  const angleDesc = VENUE_PERSUASION_ANGLES[angle];
  if (!angleDesc) throw new Error(`Unknown persuasion angle: ${angle}`);
  const fallback = {
    instagram: `${venue.name} — ${venue.description || "come see us"} in ${venue.area}. Book a table today.`,
    whatsapp: `*${venue.name}* is open in ${venue.area} — book a table today.`,
    angle,
    aiGenerated: false,
  };
  if (!aiConfigured()) return fallback;
  const prompt = `Write promotional copy for this venue, specifically framed through this persuasion angle: ${angleDesc}. Stay honest — do not invent statistics, numbers, or claims not given below. Return STRICT JSON with keys
"instagram" (caption, a few hashtags, this persuasion angle should be the clear hook),
"whatsapp" (short, punchy, *bold* markdown, same angle).
${brandKitLine(brandKit)}
Venue: ${venueLine(venue)}

Return ONLY the JSON object.`;
  try {
    const copy = await askClaudeJson(prompt, { maxTokens: 700 });
    return { ...copy, angle, aiGenerated: true };
  } catch {
    return fallback;
  }
}

export async function generateVenueBulkAdVariants(venue, brandKit, { platform = "meta", count = 3 } = {}) {
  const n = Math.max(1, Math.min(10, parseInt(count, 10) || 3));
  const isGoogle = platform === "google";
  const limits = isGoogle ? "headline <=30 characters, description <=90 characters (Google Search Ads limits)" : "headline <=40 characters, description <=125 characters (Meta/Facebook/Instagram ad limits)";
  const fallbackVariant = { headline: venue.name.slice(0, isGoogle ? 30 : 40), description: (venue.description || `Book a table at ${venue.name} in ${venue.area}.`).slice(0, isGoogle ? 90 : 125) };
  if (!aiConfigured()) return Array.from({ length: n }, () => fallbackVariant);
  const prompt = `Write ${n} distinct ad copy variants for A/B testing, promoting this real, physical venue (not a one-off event), for ${isGoogle ? "Google Search Ads" : "Meta (Facebook/Instagram) Ads"}. Each variant must have a genuinely different angle/hook (not just reworded) — vary between benefit-first, urgency, curiosity, and direct-offer framings across the set. Return STRICT JSON: an array of exactly ${n} objects {"headline":"...","description":"..."}, respecting these limits: ${limits}. Do not invent details not given.
${brandKitLine(brandKit)}
Venue: ${venueLine(venue)}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 200 + n * 120 });
    const variants = Array.isArray(result) ? result.slice(0, n) : (result.variants || []).slice(0, n);
    if (variants.length) return variants;
  } catch {
    // fall through
  }
  return Array.from({ length: n }, () => fallbackVariant);
}

export async function generateVenueFreeToolIdeas(venue) {
  const fallback = [
    { name: "Table-availability widget", description: `An embeddable widget for ${venue.name}'s own website/socials showing live table availability for the week.`, why: "Removes friction for people already considering a visit — they can see openings without calling." },
    { name: "Happy-hour countdown widget", description: "A simple countdown to the next happy hour or themed night, embeddable on the venue's site or Instagram bio link.", why: "Creates a genuine, recurring reason to check back and plan a visit around a real deadline." },
  ];
  if (!aiConfigured()) return fallback;
  const prompt = `Suggest 2-3 concrete "free tool" or "lead magnet" ideas for a real, physical venue (restaurant/cafe/lounge/rooftop/beach club/experience venue) to attract repeat visits and email signups — e.g. a table-availability widget, a happy-hour countdown, a loyalty-punch-card tracker (not generic "download our newsletter"). For each, explain briefly what it would do and why it would attract the right guests for THIS venue. This is a text concept only — nothing gets built here.
Return STRICT JSON: an array of objects {"name":"short name","description":"what it does, 1-2 sentences","why":"why it attracts the right guests for this venue, 1 sentence"}.

Venue: ${venueLine(venue)}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 700 });
    const ideas = Array.isArray(result) ? result : (result.ideas || []);
    if (ideas.length) return ideas.slice(0, 3);
  } catch {
    // fall through
  }
  return fallback;
}
