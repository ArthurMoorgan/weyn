import { type Weyn, isTonight, isThisWeekend } from "../api";

// Derives HomeFeed's personalized rails from the one events list Explore
// already fetches (api.listEvents()) — no extra endpoints. Every helper
// takes the already-upcoming, non-cancelled event list and returns at most
// 20 events, ready to hand straight to Stub variant="rail".
const LIMIT = 20;

const startTs = (e: Weyn) => new Date(e.startsAt).getTime();
const bySoonest = (a: Weyn, b: Weyn) => startTs(a) - startTs(b);
const byPopular = (a: Weyn, b: Weyn) => (b.sold || 0) - (a.sold || 0);

// "Trending" = most tickets sold relative to capacity, not raw sold count —
// a 40/50 small venue is trending harder than a 40/2000 stadium.
export function getTrendingEvents(events: Weyn[]): Weyn[] {
  return [...events]
    .sort((a, b) => (b.sold || 0) / (b.capacity || 1) - (a.sold || 0) / (a.capacity || 1))
    .slice(0, LIMIT);
}

// Closest events first — distanceKm is computed server-side from the
// caller's location.
export function getNearYouEvents(events: Weyn[]): Weyn[] {
  return [...events].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, LIMIT);
}

export function getTonightEvents(events: Weyn[]): Weyn[] {
  return events.filter(isTonight).sort(bySoonest).slice(0, LIMIT);
}

export function getThisWeekendEvents(events: Weyn[]): Weyn[] {
  return events.filter(isThisWeekend).sort(bySoonest).slice(0, LIMIT);
}

// "New" = listed in the last 7 days — id ordering isn't reliable, but every
// event's createdAt-equivalent isn't on the Weyn type, so this uses the
// closest proxy available client-side: events starting soon that also
// haven't sold any tickets yet (a fresh listing hasn't had time to sell).
// TODO: swap for a real `createdAt` field once the API exposes one.
export function getNewThisWeekEvents(events: Weyn[]): Weyn[] {
  return [...events]
    .filter((e) => (e.sold || 0) === 0)
    .sort(bySoonest)
    .slice(0, LIMIT);
}

export function getFreeEvents(events: Weyn[]): Weyn[] {
  return events.filter((e) => e.price === 0).sort(bySoonest).slice(0, LIMIT);
}

export function getUnder10Events(events: Weyn[]): Weyn[] {
  return events.filter((e) => e.price > 0 && e.price <= 10).sort(bySoonest).slice(0, LIMIT);
}

// "Hidden gems" = quality events nobody's found yet: not featured, low sold
// count, but still soon enough to be worth surfacing.
export function getHiddenGemsEvents(events: Weyn[]): Weyn[] {
  return [...events]
    .filter((e) => !e.featured && (e.sold || 0) < e.capacity * 0.2)
    .sort(bySoonest)
    .slice(0, LIMIT);
}

// "Continue exploring" = catch-all rail for whatever's left over once the
// most popular events have been surfaced elsewhere — most-popular first so
// it doesn't just repeat the soonest-first ordering every other rail uses.
export function getContinueExploringEvents(events: Weyn[]): Weyn[] {
  return [...events].sort(byPopular).slice(0, LIMIT);
}

export interface OrganizerStats {
  name: string;
  eventCount: number;
  ownerId?: string; // organizer's user ID if available
}

// Extract popular organizers from events: unique organizers, count events,
// sort by event count DESC, return top 5-6.
export function getPopularOrganizers(events: Weyn[]): OrganizerStats[] {
  const orgMap = new Map<string, { count: number; ownerId?: string }>();

  for (const e of events) {
    const org = e.organizer;
    if (!org) continue;

    const current = orgMap.get(org);
    if (current) {
      current.count++;
    } else {
      orgMap.set(org, { count: 1, ownerId: e.ownerId ?? undefined });
    }
  }

  return Array.from(orgMap.entries())
    .map(([name, { count, ownerId }]) => ({ name, eventCount: count, ownerId }))
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, 6);
}

// Popular searches: hard-coded list of trending search terms derived from
// category names and common time-based searches. Displayed when search is
// empty to help users discover events.
export function getPopularSearches(): string[] {
  return [
    "Music Events",
    "Sports Tonight",
    "Free Events",
    "This Weekend",
    "Food & Dining",
    "Workshops",
    "Live Theater",
  ];
}
