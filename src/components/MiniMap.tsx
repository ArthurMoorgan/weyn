import { useEffect, useRef, useState } from "react";
import L from "leaflet";
// See MapPicker: leaflet CSS scoped to this lazy chunk, not the global
// render-blocking entry stylesheet.
import "leaflet/dist/leaflet.css";
import { GOOGLE_MAPS_KEY, loadGoogleMaps } from "../google-maps";

const osmPinIcon = L.divIcon({
  className: "",
  html: `<div class="map-pin"><span></span></div>`,
  iconSize: [30, 38],
  iconAnchor: [15, 36],
});

// read-only location preview with a pin — real Google Maps (default style,
// default pin) when a key is configured, same free OSM/Leaflet fallback as
// before otherwise.
export default function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const gMapRef = useRef<google.maps.Map | null>(null);
  const lMapRef = useRef<L.Map | null>(null);
  const [usingGoogle, setUsingGoogle] = useState<boolean | null>(GOOGLE_MAPS_KEY ? null : false);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY || !elRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      ?.then((g) => {
        if (cancelled || !elRef.current) return;
        const map = new g.maps.Map(elRef.current, {
          center: { lat, lng }, zoom: 15,
          disableDefaultUI: true, gestureHandling: "none", keyboardShortcuts: false,
        });
        new g.maps.Marker({ position: { lat, lng }, map });
        gMapRef.current = map;

        // See MapPicker.tsx for why this timeout-based check exists — some
        // failures (no billing on the key's Cloud project, etc.) never throw
        // or call gm_authFailure, they just never fire `tilesloaded`.
        let tilesOk = false;
        const tilesListener = g.maps.event.addListenerOnce(map, "tilesloaded", () => { tilesOk = true; });
        setTimeout(() => {
          if (tilesOk) return;
          g.maps.event.removeListener(tilesListener);
          gMapRef.current = null;
          if (elRef.current) elRef.current.innerHTML = "";
          setUsingGoogle(false);
        }, 2500);

        setUsingGoogle(true);
      })
      .catch(() => setUsingGoogle(false));
    return () => { cancelled = true; gMapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  useEffect(() => {
    if (usingGoogle !== false || !elRef.current || lMapRef.current) return;
    const map = L.map(elRef.current, {
      attributionControl: false, zoomControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false,
    }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    L.marker([lat, lng], { icon: osmPinIcon }).addTo(map);
    lMapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); lMapRef.current = null; };
  }, [usingGoogle, lat, lng]);

  return <div ref={elRef} className="map-canvas mini" />;
}
