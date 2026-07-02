import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { GOOGLE_MAPS_KEY, loadGoogleMaps } from "../google-maps";

// teal HTML pin — avoids Leaflet's broken default-marker asset paths under bundlers
const pinIcon = L.divIcon({
  className: "",
  html: `<div class="map-pin"><span></span></div>`,
  iconSize: [30, 38],
  iconAnchor: [15, 36],
});

const MUSCAT: [number, number] = [23.61, 58.54];
// rough bounding box around greater Muscat, used to bias the free OSM fallback search
const MUSCAT_VIEWBOX = "58.0,23.9,59.0,23.3"; // left,top,right,bottom

export default function MapPicker({
  value, onChange,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (c: { lat: number; lng: number; label?: string }) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [usingGoogle, setUsingGoogle] = useState(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start: [number, number] = value ? [value.lat, value.lng] : MUSCAT;
    const map = L.map(elRef.current, { attributionControl: false, zoomControl: true }).setView(start, value ? 15 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const marker = L.marker(start, { icon: pinIcon, draggable: true }).addTo(map);

    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
    });

    mapRef.current = map;
    markerRef.current = marker;
    // first paint sometimes needs a nudge inside flex/animated containers
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function jumpTo(lat: number, lng: number, label?: string) {
    mapRef.current?.setView([lat, lng], 16);
    markerRef.current?.setLatLng([lat, lng]);
    onChangeRef.current({ lat, lng, label });
    setResults([]);
  }

  // ---- Google Places Autocomplete (much better address matching, needs an API key) ----
  useEffect(() => {
    if (!GOOGLE_MAPS_KEY || !inputRef.current) return;
    let ac: google.maps.places.Autocomplete | null = null;
    let cancelled = false;
    loadGoogleMaps()
      ?.then((g) => {
        if (cancelled || !inputRef.current) return;
        ac = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ["geometry", "name", "formatted_address"],
          componentRestrictions: { country: "om" },
        });
        ac.addListener("place_changed", () => {
          const place = ac!.getPlace();
          const loc = place.geometry?.location;
          if (!loc) { setErr("No details for that place — try another suggestion."); return; }
          setErr("");
          jumpTo(+loc.lat().toFixed(6), +loc.lng().toFixed(6), place.name || place.formatted_address);
          setQ(place.name || place.formatted_address || "");
        });
        setUsingGoogle(true);
      })
      .catch(() => setUsingGoogle(false)); // key present but script failed (bad key/network) — fall back silently
    return () => {
      cancelled = true;
      if (ac) google.maps.event.clearInstanceListeners(ac);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- free OpenStreetMap/Nominatim fallback (used only without a Google key) ----
  async function searchOSM(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true); setErr(""); setResults([]);
    try {
      const query = /oman/i.test(q) ? q : `${q}, Muscat, Oman`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=om&viewbox=${MUSCAT_VIEWBOX}&bounded=0&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const hits = await res.json();
      if (!hits.length) { setErr("No place found — try a shorter search or drop the pin manually."); return; }
      if (hits.length === 1) {
        jumpTo(+(+hits[0].lat).toFixed(6), +(+hits[0].lon).toFixed(6), hits[0].display_name?.split(",")[0]);
      } else {
        setResults(hits.map((h: any) => ({ lat: +h.lat, lng: +h.lon, label: h.display_name })));
      }
    } catch {
      setErr("Couldn't reach the map search. Drop the pin manually.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mappick">
      <form className="map-search" onSubmit={usingGoogle ? (e) => e.preventDefault() : searchOSM}>
        <i className="ti ti-search" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={usingGoogle ? "Search any address…" : "Search a place in Muscat…"}
        />
        {!usingGoogle && <button type="submit" disabled={searching}>{searching ? "…" : "Find"}</button>}
      </form>

      {results.length > 0 && (
        <div className="map-results">
          {results.map((r, i) => (
            <button key={i} type="button" onClick={() => jumpTo(r.lat, r.lng, r.label.split(",")[0])}>
              <i className="ti ti-map-pin" /> {r.label}
            </button>
          ))}
        </div>
      )}

      <div ref={elRef} className="map-canvas" />
      <p className="hint"><i className="ti ti-hand-finger" /> Tap the map or drag the pin to set the exact spot.</p>
      {err && <p className="errline" style={{ margin: "4px 0 0" }}>{err}</p>}
      {!GOOGLE_MAPS_KEY && (
        <p className="hint" style={{ marginTop: 4 }}>
          Using free address search. For better results, set <code>VITE_GOOGLE_MAPS_KEY</code>.
        </p>
      )}
    </div>
  );
}
