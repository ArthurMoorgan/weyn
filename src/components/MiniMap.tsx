import { useEffect, useRef } from "react";
import L from "leaflet";

const pinIcon = L.divIcon({
  className: "",
  html: `<div class="map-pin"><span></span></div>`,
  iconSize: [30, 38],
  iconAnchor: [15, 36],
});

// read-only location preview with a pin
export default function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      attributionControl: false, zoomControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false,
    }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; };
  }, [lat, lng]);

  return <div ref={elRef} className="map-canvas mini" />;
}
