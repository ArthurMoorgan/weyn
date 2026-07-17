import { useMemo } from "react";
import { type Weyn } from "../api";

export interface EventCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  events: Weyn[];
}

// Cell size in degrees at each zoom level — coarser grid at low zoom (city
// view, pins overlap heavily) down to no clustering at all once zoomed in
// enough that individual pins have room to breathe. Google's own zoom scale
// roughly doubles ground resolution per level, so cell size halves per step.
function cellSizeDeg(zoom: number): number {
  if (zoom <= 10) return 0.08;
  if (zoom <= 12) return 0.04;
  if (zoom <= 14) return 0.015;
  if (zoom <= 16) return 0.005;
  return 0; // fully zoomed in — every event stands on its own
}

// Groups events into a simple lat/lng grid: each cell becomes one cluster,
// centered on the mean position of its events. Deliberately not a proper
// spatial index (k-d tree, quadtree) — event counts here are small enough
// (dozens, not thousands) that an O(n) pass per zoom change is plenty, and
// it's a lot easier to read than pulling in a clustering library.
export function useClustering(events: Weyn[], zoom: number): EventCluster[] {
  return useMemo(() => {
    const size = cellSizeDeg(zoom);
    if (size === 0) {
      return events.map((e) => ({ id: e.id, lat: e.lat, lng: e.lng, count: 1, events: [e] }));
    }

    const cells = new Map<string, Weyn[]>();
    for (const e of events) {
      const key = `${Math.floor(e.lat / size)}:${Math.floor(e.lng / size)}`;
      const bucket = cells.get(key);
      if (bucket) bucket.push(e);
      else cells.set(key, [e]);
    }

    return Array.from(cells.entries()).map(([key, bucket]) => ({
      id: key,
      lat: bucket.reduce((sum, e) => sum + e.lat, 0) / bucket.length,
      lng: bucket.reduce((sum, e) => sum + e.lng, 0) / bucket.length,
      count: bucket.length,
      events: bucket,
    }));
  }, [events, zoom]);
}
