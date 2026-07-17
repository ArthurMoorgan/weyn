import { Weyn } from "../api";

export interface Cluster {
  sw: google.maps.LatLng;
  ne: google.maps.LatLng;
  events: Weyn[];
  centerLat: number;
  centerLng: number;
}

/**
 * Grid-based event clustering for map display.
 *
 * Reduces visual clutter by grouping nearby events into clusters based on map zoom.
 * - At zoom >= 14, returns individual events (one cluster per event).
 * - At zoom < 14, groups events into grid cells. Grid cell size adapts based on zoom.
 *   Coarser grid at lower zoom (more grouping), finer grid at higher zoom (less grouping).
 *
 * @param events - Array of events with lat/lng coordinates
 * @param zoom - Current map zoom level (0-21 in Google Maps)
 * @param mapBounds - Current visible map bounds (google.maps.LatLngBounds)
 * @returns Array of clusters, each containing events within a grid cell and the cell bounds
 */
export function clusterEvents(
  events: Weyn[],
  zoom: number,
  mapBounds: google.maps.LatLngBounds
): Cluster[] {
  const g = (window as any).google;

  // At zoom >= 14, show individual events without clustering
  if (zoom >= 14) {
    return events.map((event) => ({
      sw: new g.maps.LatLng(event.lat, event.lng),
      ne: new g.maps.LatLng(event.lat, event.lng),
      events: [event],
      centerLat: event.lat,
      centerLng: event.lng,
    }));
  }

  // Grid-based clustering at zoom < 14
  // Get bounds and calculate grid cell size
  const sw = mapBounds.getSouthWest();
  const ne = mapBounds.getNorthEast();
  const latRange = ne.lat() - sw.lat();
  const lngRange = ne.lng() - sw.lng();

  // Adaptive grid: smaller cells at higher zoom levels.
  // Divides visible area into approximately 2^(14-zoom) cells per dimension.
  // At zoom 12: ~4x4 grid; at zoom 10: ~16x16 grid.
  const gridSize = Math.max(latRange, lngRange) / Math.pow(2, Math.max(0, 14 - zoom));

  // Map events to grid cells by key
  const gridMap = new Map<string, Weyn[]>();

  events.forEach((event) => {
    const gridLat = Math.floor((event.lat - sw.lat()) / gridSize);
    const gridLng = Math.floor((event.lng - sw.lng()) / gridSize);
    const key = `${gridLat},${gridLng}`;

    if (!gridMap.has(key)) {
      gridMap.set(key, []);
    }
    gridMap.get(key)!.push(event);
  });

  // Convert grid cells to clusters
  const clusters: Cluster[] = [];

  gridMap.forEach((cellEvents) => {
    // Find bounding box of all events in this cluster
    let minLat = cellEvents[0].lat;
    let maxLat = cellEvents[0].lat;
    let minLng = cellEvents[0].lng;
    let maxLng = cellEvents[0].lng;
    let sumLat = 0;
    let sumLng = 0;

    cellEvents.forEach((event) => {
      minLat = Math.min(minLat, event.lat);
      maxLat = Math.max(maxLat, event.lat);
      minLng = Math.min(minLng, event.lng);
      maxLng = Math.max(maxLng, event.lng);
      sumLat += event.lat;
      sumLng += event.lng;
    });

    clusters.push({
      sw: new g.maps.LatLng(minLat, minLng),
      ne: new g.maps.LatLng(maxLat, maxLng),
      events: cellEvents,
      centerLat: sumLat / cellEvents.length,
      centerLng: sumLng / cellEvents.length,
    });
  });

  return clusters;
}
