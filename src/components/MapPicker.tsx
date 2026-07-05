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
  const [pinLabel, setPinLabel] = useState("");
  const geocodeSeqRef = useRef(0);

  // Reverse-geocode a dropped/dragged/clicked pin so the picker always shows
  // *something* for "where did I just point at" — Google's Geocoder if the
  // key is live, else free Nominatim. Best-effort: on failure we just show
  // coordinates instead of blocking the pick.
  async function reverseGeocode(lat: number, lng: number) {
    const seq = ++geocodeSeqRef.current;
    const apply = (label: string) => {
      if (seq !== geocodeSeqRef.current) return; // a newer pick superseded this one
      setPinLabel(label);
      onChangeRef.current({ lat, lng, label });
    };
    if (usingGoogle && (window as any).google?.maps) {
      const geocoder = new (window as any).google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results: any, status: string) => {
        if (status === "OK" && results?.[0]) apply(results[0].formatted_address);
        else apply(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      });
      return;
    }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
      const hit = await res.json();
      apply(hit?.display_name?.split(",").slice(0, 2).join(",") || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch {
      apply(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }
  }

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start: [number, number] = value ? [value.lat, value.lng] : MUSCAT;
    const map = L.map(elRef.current, { attributionControl: false, zoomControl: true }).setView(start, value ? 15 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const marker = L.marker(start, { icon: pinIcon, draggable: true }).addTo(map);

    marker.on("dragend", () => {
      const p = marker.getLatLng();
      const lat = +p.lat.toFixed(6), lng = +p.lng.toFixed(6);
      onChangeRef.current({ lat, lng });
      reverseGeocode(lat, lng);
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      const lat = +e.latlng.lat.toFixed(6), lng = +e.latlng.lng.toFixed(6);
      onChangeRef.current({ lat, lng });
      reverseGeocode(lat, lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    // first paint sometimes needs a nudge inside flex/animated containers
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the map in sync when `value` changes from OUTSIDE this component
  // (e.g. a parent resetting the form, or restoring a saved event to edit) —
  // previously the map only ever centered once, on mount.
  const lastAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!value || !mapRef.current || !markerRef.current) return;
    const key = `${value.lat},${value.lng}`;
    if (key === lastAppliedRef.current) return;
    lastAppliedRef.current = key;
    mapRef.current.setView([value.lat, value.lng], 15);
    markerRef.current.setLatLng([value.lat, value.lng]);
  }, [value?.lat, value?.lng]);

  function jumpTo(lat: number, lng: number, label?: string) {
    mapRef.current?.setView([lat, lng], 16);
    markerRef.current?.setLatLng([lat, lng]);
    lastAppliedRef.current = `${lat},${lng}`;
    if (label) setPinLabel(label);
    onChangeRef.current({ lat, lng, label });
    setResults([]);
    setGooglePredictions([]);
    if (!label) reverseGeocode(lat, lng);
  }

  // ---- Google Places (much better address matching, needs an API key) ----
  // Deliberately NOT using google.maps.places.Autocomplete (the legacy widget
  // that injects its own `.pac-container` dropdown) — when the underlying
  // Places API call fails (e.g. billing/API-not-enabled on the Cloud project),
  // that widget renders broken icon glyphs into its dropdown on every
  // keystroke instead of failing cleanly. Driving AutocompleteService
  // ourselves and rendering into the SAME `.map-results` list already built
  // for the free OSM fallback means a Google failure just falls through to
  // our own error/empty state, never garbled default-widget output.
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    let cancelled = false;
    loadGoogleMaps()
      ?.then((g) => {
        if (cancelled) return;
        autocompleteServiceRef.current = new g.maps.places.AutocompleteService();
        // PlacesService needs a Map or a DOM node to attach to — a detached
        // div works fine, we never render anything from it.
        placesServiceRef.current = new g.maps.places.PlacesService(document.createElement("div"));
        setUsingGoogle(true);
      })
      .catch(() => setUsingGoogle(false)); // key present but script failed (bad key/network) — fall back silently
    return () => { cancelled = true; };
  }, []);

  function onGoogleQueryChange(value: string) {
    setQ(value);
    setErr("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || !autocompleteServiceRef.current) { setGooglePredictions([]); return; }
    debounceRef.current = setTimeout(() => {
      autocompleteServiceRef.current!.getPlacePredictions(
        { input: value, componentRestrictions: { country: "om" } },
        (predictions, status) => {
          if (status !== "OK" || !predictions?.length) {
            // Google failed (billing/API-not-enabled) or found nothing —
            // fall through to the free OSM search instead of leaving the
            // box looking like typing does nothing.
            setGooglePredictions([]);
            searchOSMQuery(value);
            return;
          }
          setGooglePredictions(predictions);
        }
      );
    }, 300);
  }

  // Enter key (or the visible Find button, when shown) always does
  // *something* — Google predictions if available, else OSM search —
  // rather than being silently swallowed while usingGoogle is true.
  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (googlePredictions.length) { pickGooglePrediction(googlePredictions[0]); return; }
    searchOSMQuery(q);
  }

  const [googlePredictions, setGooglePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);

  function pickGooglePrediction(p: google.maps.places.AutocompletePrediction) {
    if (!placesServiceRef.current) return;
    placesServiceRef.current.getDetails({ placeId: p.place_id, fields: ["geometry", "name", "formatted_address"] }, (place, status) => {
      const loc = place?.geometry?.location;
      if (status !== "OK" || !loc) { setErr("No details for that place — try another suggestion."); return; }
      setErr("");
      jumpTo(+loc.lat().toFixed(6), +loc.lng().toFixed(6), place?.name || place?.formatted_address);
      setQ(place?.name || place?.formatted_address || "");
      setGooglePredictions([]);
    });
  }

  // ---- free OpenStreetMap/Nominatim fallback (used without a Google key,
  // and as the automatic fallback when Google's Places calls fail/find nothing) ----
  async function searchOSMQuery(query: string) {
    if (!query.trim()) return;
    setSearching(true); setErr(""); setResults([]);
    try {
      const fullQuery = /oman/i.test(query) ? query : `${query}, Muscat, Oman`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=om&viewbox=${MUSCAT_VIEWBOX}&bounded=0&q=${encodeURIComponent(fullQuery)}`;
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
      <form className="map-search" onSubmit={onSubmitSearch}>
        <i className="icon-search" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => (usingGoogle ? onGoogleQueryChange(e.target.value) : setQ(e.target.value))}
          placeholder={usingGoogle ? "Search any address…" : "Search a place in Muscat…"}
        />
        <button type="submit" disabled={searching}>{searching ? "…" : "Find"}</button>
      </form>

      {usingGoogle && googlePredictions.length > 0 && (
        <div className="map-results">
          {googlePredictions.map((p) => (
            <button key={p.place_id} type="button" onClick={() => pickGooglePrediction(p)}>
              <i className="icon-map-pin" /> {p.description}
            </button>
          ))}
        </div>
      )}
      {results.length > 0 && (
        <div className="map-results">
          {results.map((r, i) => (
            <button key={i} type="button" onClick={() => jumpTo(r.lat, r.lng, r.label.split(",")[0])}>
              <i className="icon-map-pin" /> {r.label}
            </button>
          ))}
        </div>
      )}

      <div ref={elRef} className="map-canvas" />
      {pinLabel ? (
        <p className="hint" style={{ color: "var(--text, inherit)" }}><i className="icon-map-pin" /> Pinned: {pinLabel}</p>
      ) : (
        <p className="hint"><i className="icon-pointer" /> Tap the map or drag the pin to set the exact spot.</p>
      )}
      {err && <p className="errline" style={{ margin: "4px 0 0" }}>{err}</p>}
      {!GOOGLE_MAPS_KEY && (
        <p className="hint" style={{ marginTop: 4 }}>
          Using free address search. For better results, set <code>VITE_GOOGLE_MAPS_KEY</code>.
        </p>
      )}
    </div>
  );
}
