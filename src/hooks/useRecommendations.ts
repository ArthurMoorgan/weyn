import { useMemo } from "react";
import type { Weyn } from "../api";
import { isPast } from "../api";
import { useSaved } from "../store";
import { getRecentlyViewed } from "./useRecentlyViewed";

// Personalized "Recommended for you" ranking — the one genuinely-missing
// discovery feature (District's personalized-recs, BACKEND_TODO.md #1, which
// had been a stub). Deliberately client-side: it's derived from the same
// single events fetch Explore already has plus the per-device saved list and
// recently-viewed history, so it needs no recommendation-engine backend and
// works offline. If/when a server-side collaborative-filtering engine lands,
// this stays a sensible cold-start fallback.
//
// Affinity model: build a weighted taste profile from what the user has
// engaged with (saving is a much stronger signal than a passing view), then
// score every candidate event by how well it matches — same category,
// organizer, and area they've shown interest in, plus a nudge toward their
// usual price band. Already-saved events are excluded (they have them); the
// output is the fresh events most likely to land.

const W = {
  savedCat: 3.0,
  savedOrganizer: 3.5,
  savedArea: 1.5,
  viewedCat: 1.0,
  viewedOrganizer: 1.2,
  viewedArea: 0.5,
  priceBand: 1.0,
  // small tiebreakers so a cold/low-signal profile still surfaces the good stuff
  featured: 0.4,
  popular: 0.3,
};

type Profile = {
  cats: Map<string, number>;
  organizers: Map<string, number>;
  areas: Map<string, number>;
  avgPrice: number | null;
  signalCount: number;
};

function bump(m: Map<string, number>, key: string | undefined, by: number) {
  if (!key) return;
  m.set(key, (m.get(key) ?? 0) + by);
}

function buildProfile(all: Weyn[], savedIds: string[], viewedIds: string[]): Profile {
  const byId = new Map(all.map((e) => [e.id, e]));
  const cats = new Map<string, number>();
  const organizers = new Map<string, number>();
  const areas = new Map<string, number>();
  const prices: number[] = [];

  for (const id of savedIds) {
    const e = byId.get(id);
    if (!e) continue;
    bump(cats, e.cat, W.savedCat);
    bump(organizers, e.organizer, W.savedOrganizer);
    bump(areas, e.area, W.savedArea);
    if (e.price > 0) prices.push(e.price);
  }
  for (const id of viewedIds) {
    const e = byId.get(id);
    if (!e) continue;
    bump(cats, e.cat, W.viewedCat);
    bump(organizers, e.organizer, W.viewedOrganizer);
    bump(areas, e.area, W.viewedArea);
    if (e.price > 0) prices.push(e.price);
  }

  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  // distinct engaged items — how much signal we actually have
  const signalCount = new Set([...savedIds, ...viewedIds]).size;
  return { cats, organizers, areas, avgPrice, signalCount };
}

function score(e: Weyn, p: Profile): number {
  let s = 0;
  s += p.cats.get(e.cat) ?? 0;
  s += p.organizers.get(e.organizer) ?? 0;
  s += p.areas.get(e.area) ?? 0;
  // price affinity: full credit within ~40% of the usual spend, tapering off
  if (p.avgPrice !== null && e.price > 0) {
    const ratio = Math.abs(e.price - p.avgPrice) / p.avgPrice;
    if (ratio <= 0.4) s += W.priceBand * (1 - ratio / 0.4);
  }
  if (e.featured) s += W.featured;
  s += Math.min(W.popular, (e.sold || 0) / 500); // gentle popularity tiebreak
  return s;
}

// Minimum distinct saved/viewed events before we show a "for you" row — below
// this the profile is too thin to be meaningfully personal (better to show
// nothing than a random-looking rail).
const MIN_SIGNAL = 2;

export interface Recommendations {
  events: Weyn[];
  hasSignal: boolean;
}

export function recommend(all: Weyn[], savedIds: string[], viewedIds: string[], limit = 6): Recommendations {
  const upcoming = all.filter((e) => !e.cancelled && !isPast(e));
  const profile = buildProfile(upcoming, savedIds, viewedIds);
  if (profile.signalCount < MIN_SIGNAL) return { events: [], hasSignal: false };

  const savedSet = new Set(savedIds);
  const ranked = upcoming
    .filter((e) => !savedSet.has(e.id))
    .map((e) => ({ e, s: score(e, profile) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);

  return { events: ranked, hasSignal: true };
}

// Hook form: subscribes to the saved store so the row re-ranks the moment the
// user saves something new, and reads the recently-viewed history once per
// events change.
export function useRecommendations(all: Weyn[] | null | undefined, limit = 6): Recommendations {
  const savedIds = useSaved();
  return useMemo(
    () => recommend(all ?? [], savedIds, getRecentlyViewed(), limit),
    [all, savedIds, limit]
  );
}
