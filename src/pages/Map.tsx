import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { api, type Weyn } from "../api";
import { useAsync } from "../hooks";
import { useGoogleMapInstance } from "../hooks/useGoogleMapInstance";
import { useGeolocation } from "../hooks/useGeolocation";
import { useClustering, type EventCluster } from "../hooks/useClustering";
import EventPinSheet from "../components/EventPinSheet";
import Tooltip from "../components/Tooltip";

// Small SVG data-uri pins/pills — cheaper than loading marker images, and
// lets each one pick up the event's own color at render time.
function pinIcon(color: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="15" r="6" fill="#fff"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;base64,${btoa(svg)}`,
    scaledSize: new google.maps.Size(30, 38),
    anchor: new google.maps.Point(15, 36),
  };
}

function clusterIcon(count: number): google.maps.Icon {
  const label = `${count} event${count === 1 ? "" : "s"} here`;
  const w = 24 + label.length * 7;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="34" viewBox="0 0 ${w} 34">
    <rect x="1" y="1" width="${w - 2}" height="32" rx="16" fill="#4a4a4a" stroke="#fff" stroke-width="2"/>
    <text x="${w / 2}" y="21" font-family="sans-serif" font-size="13" font-weight="600" fill="#fff" text-anchor="middle">${label}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;base64,${btoa(svg)}`,
    scaledSize: new google.maps.Size(w, 34),
    anchor: new google.maps.Point(w / 2, 17),
  };
}

const dotIcon: google.maps.Symbol = {
  path: google.maps?.SymbolPath?.CIRCLE,
  scale: 7,
  fillColor: "#4285F4",
  fillOpacity: 1,
  strokeColor: "#fff",
  strokeWeight: 2,
};

export default function Map() {
  const nav = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, loading: mapLoading, error: mapError, currentZoom } = useGoogleMapInstance(containerRef);
  const { data: events, loading: eventsLoading } = useAsync(() => api.listEvents(), []);
  const { coords: myLocation } = useGeolocation();

  const clusters = useClustering(events ?? [], currentZoom);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const markersRef = useRef<google.maps.Marker[]>([]);
  const meMarkerRef = useRef<google.maps.Marker | null>(null);

  // Repaint markers whenever the map exists, the cluster set changes (new
  // events, zoom threshold crossed), or the underlying data reloads.
  useEffect(() => {
    if (!map) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = clusters.map((cluster: EventCluster) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: cluster.lat, lng: cluster.lng },
        icon: cluster.count > 1 ? clusterIcon(cluster.count) : pinIcon(cluster.events[0].color),
      });
      marker.addListener("click", () => {
        if (cluster.count === 1) {
          setSelectedEventId(cluster.events[0].id);
        } else {
          map.setZoom((map.getZoom() ?? 12) + 2);
          map.panTo({ lat: cluster.lat, lng: cluster.lng });
        }
      });
      return marker;
    });
    return () => markersRef.current.forEach((m) => m.setMap(null));
  }, [map, clusters]);

  // Blue dot for the visitor's own location, once geolocation resolves.
  useEffect(() => {
    if (!map || !myLocation) return;
    meMarkerRef.current?.setMap(null);
    meMarkerRef.current = new google.maps.Marker({
      map,
      position: myLocation,
      icon: dotIcon,
      zIndex: 999,
      clickable: false,
    });
    return () => meMarkerRef.current?.setMap(null);
  }, [map, myLocation]);

  const selectedEvent = events?.find((e) => e.id === selectedEventId) ?? null;
  const loading = mapLoading || eventsLoading;

  return (
    <div className="map-page">
      <Tooltip text="Back">
        <button className="icon-btn map-back" onClick={() => nav(-1)} aria-label="Back">
          <i className="icon-arrow-left" />
        </button>
      </Tooltip>

      <div ref={containerRef} className="map-canvas full" />

      <AnimatePresence>
        {loading && (
          <motion.div
            className="map-loading"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="skel-cardrow" style={{ width: 220 }}>
              <span className="sk sk-cover" style={{ width: "100%", height: 120 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!loading && mapError && (
        <div className="map-fallback">
          <i className="icon-map-pin" />
          <p>Map unavailable right now — browse events in the list instead.</p>
          <button className="btn glass" onClick={() => nav("/explore")}>Go to Explore</button>
        </div>
      )}

      <EventPinSheet event={selectedEvent} open={!!selectedEvent} onClose={() => setSelectedEventId(null)} />
    </div>
  );
}
