import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { GOOGLE_MAPS_KEY, loadGoogleMaps } from "../google-maps";

// teal HTML pin — only used for the free OSM fallback map (no Google key).
// The real Google Maps path below uses Google's own default red pin, on
// purpose — "plain, good old Google Maps," not a themed one.
const osmPinIcon = L.divIcon({
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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [usingGoogle, setUsingGoogle] = useState<boolean | null>(GOOGLE_MAPS_KEY ? null : false); // null = "loading, not decided yet"
  const [pinLabel, setPinLabel] = useState("");
  const geocodeSeqRef = useRef(0);

  // ============================================================
  // Real Google Maps — plain, default styling (no styles[] array),
  // Google's own default red pin (no custom icon). Only used once we know
  // the Maps JS API actually loaded; falls back to the free Leaflet/OSM map
  // below otherwise, same as before.
  // ============================================================
  const gMapRef = useRef<google.maps.Map | null>(null);
  const gMarkerRef = useRef<google.maps.Marker | null>(null);
  const gAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const gGeocoderRef = useRef<google.maps.Geocoder | null>(null);

  // ============================================================
  // Free OpenStreetMap/Leaflet fallback — unchanged, used only when no
  // Google Maps key is configured (or the script fails to load).
  // ============================================================
  const lMapRef = useRef<L.Map | null>(null);
  const lMarkerRef = useRef<L.Marker | null>(null);

  async function reverseGeocode(lat: number, lng: number) {
    const seq = ++geocodeSeqRef.current;
    const apply = (label: string) => {
      if (seq !== geocodeSeqRef.current) return; // a newer pick superseded this one
      setPinLabel(label);
      onChangeRef.current({ lat, lng, label });
    };
    if (gGeocoderRef.current) {
      gGeocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
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

  // ---- try Google Maps first ----
  useEffect(() => {
    if (!GOOGLE_MAPS_KEY || !elRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      ?.then((g) => {
        if (cancelled || !elRef.current) return;
        const start = value ? { lat: value.lat, lng: value.lng } : { lat: MUSCAT[0], lng: MUSCAT[1] };
        // No `styles` array here on purpose — this renders Google's actual
        // default map (roads, labels, POI icons, everything), not a themed
        // reskin of it.
        const map = new g.maps.Map(elRef.current, {
          center: start,
          zoom: value ? 15 : 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        // Some failure modes (no billing account on the key's Cloud project,
        // a domain-restricted key hit from the wrong origin) don't throw or
        // call gm_authFailure — Google just renders its own "This page can't
        // load Google Maps correctly" dialog over a blank grey map and never
        // fires `tilesloaded`. If that hasn't happened shortly after the map
        // is created, treat it as a failed load and fall back to OSM instead
        // of leaving Google's broken-looking dialog on screen for real users.
        let tilesOk = false;
        const tilesListener = g.maps.event.addListenerOnce(map, "tilesloaded", () => { tilesOk = true; });
        const failTimer = setTimeout(() => {
          if (tilesOk) return;
          g.maps.event.removeListener(tilesListener);
          gMapRef.current = null;
          gMarkerRef.current = null;
          gAutocompleteRef.current = null;
          // google.maps.Map has no destroy method — clear its container so
          // Leaflet can safely take over the same div in the fallback effect.
          if (elRef.current) elRef.current.innerHTML = "";
          setUsingGoogle(false);
        }, 2500);
        g.maps.event.addListenerOnce(map, "tilesloaded", () => clearTimeout(failTimer));

        // Default Marker with no custom icon — Google's own red pin.
        const marker = new g.maps.Marker({ position: start, map, draggable: true });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (!p) return;
          const lat = +p.lat().toFixed(6), lng = +p.lng().toFixed(6);
          onChangeRef.current({ lat, lng });
          reverseGeocode(lat, lng);
        });
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          marker.setPosition(e.latLng);
          const lat = +e.latLng.lat().toFixed(6), lng = +e.latLng.lng().toFixed(6);
          onChangeRef.current({ lat, lng });
          reverseGeocode(lat, lng);
        });

        gMapRef.current = map;
        gMarkerRef.current = marker;
        gGeocoderRef.current = new g.maps.Geocoder();

        // The official Places Autocomplete widget, bound straight to our
        // search input — Google's own dropdown (`.pac-container`), the
        // most reliably-working path since it's exactly what Google tests
        // against, rather than a hand-rolled prediction list.
        if (inputRef.current) {
          const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
            componentRestrictions: { country: "om" },
            fields: ["geometry", "name", "formatted_address"],
          });
          autocomplete.bindTo("bounds", map);
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            const loc = place.geometry?.location;
            if (!loc) { setErr("No details for that place — try another suggestion or drop the pin manually."); return; }
            setErr("");
            const lat = +loc.lat().toFixed(6), lng = +loc.lng().toFixed(6);
            map.setCenter({ lat, lng });
            map.setZoom(16);
            marker.setPosition({ lat, lng });
            const label = place.name || place.formatted_address;
            if (label) setPinLabel(label);
            onChangeRef.current({ lat, lng, label });
            setQ(label || "");
          });
          gAutocompleteRef.current = autocomplete;
        }

        setUsingGoogle(true);
      })
      .catch(() => setUsingGoogle(false)); // key present but script failed (bad key/network/billing) — fall back to OSM
    return () => {
      cancelled = true;
      gMapRef.current = null;
      gMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- free OSM/Leaflet fallback map — only mounted once we know Google isn't usable ----
  useEffect(() => {
    if (usingGoogle !== false || !elRef.current || lMapRef.current) return;
    const start: [number, number] = value ? [value.lat, value.lng] : MUSCAT;
    const map = L.map(elRef.current, { attributionControl: false, zoomControl: true }).setView(start, value ? 15 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const marker = L.marker(start, { icon: osmPinIcon, draggable: true }).addTo(map);

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

    lMapRef.current = map;
    lMarkerRef.current = marker;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); lMapRef.current = null; lMarkerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingGoogle]);

  // Keep the map in sync when `value` changes from OUTSIDE this component
  // (e.g. a parent resetting the form, or restoring a saved event to edit).
  const lastAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const key = `${value.lat},${value.lng}`;
    if (key === lastAppliedRef.current) return;
    lastAppliedRef.current = key;
    if (gMapRef.current && gMarkerRef.current) {
      gMapRef.current.setCenter({ lat: value.lat, lng: value.lng });
      gMapRef.current.setZoom(15);
      gMarkerRef.current.setPosition({ lat: value.lat, lng: value.lng });
    } else if (lMapRef.current && lMarkerRef.current) {
      lMapRef.current.setView([value.lat, value.lng], 15);
      lMarkerRef.current.setLatLng([value.lat, value.lng]);
    }
  }, [value?.lat, value?.lng]);

  function jumpTo(lat: number, lng: number, label?: string) {
    if (gMapRef.current && gMarkerRef.current) {
      gMapRef.current.setCenter({ lat, lng });
      gMapRef.current.setZoom(16);
      gMarkerRef.current.setPosition({ lat, lng });
    } else if (lMapRef.current && lMarkerRef.current) {
      lMapRef.current.setView([lat, lng], 16);
      lMarkerRef.current.setLatLng([lat, lng]);
    }
    lastAppliedRef.current = `${lat},${lng}`;
    if (label) setPinLabel(label);
    onChangeRef.current({ lat, lng, label });
    setResults([]);
    if (!label) reverseGeocode(lat, lng);
  }

  // Plain OSM text search — only reachable when Google Maps isn't available,
  // since the Google path above hands search entirely to the official
  // Autocomplete widget instead of this form's submit handler.
  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!usingGoogle) searchOSMQuery(q);
  }

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
          onChange={(e) => setQ(e.target.value)}
          placeholder={usingGoogle ? "Search any address…" : "Search a place in Muscat…"}
          autoComplete="off"
        />
        {!usingGoogle && <button type="submit" disabled={searching}>{searching ? "…" : "Find"}</button>}
      </form>

      {/* Google's own Autocomplete widget renders its dropdown (.pac-container)
          as a sibling of <body>, positioned by Google itself — nothing to
          render here for that path. This list is only for the free OSM
          fallback's multi-result case. */}
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
      {usingGoogle === false && (
        <p className="hint" style={{ marginTop: 4 }}>
          Using free address search — Google Maps didn't load (check <code>VITE_GOOGLE_MAPS_KEY</code> and that the Places API is enabled for it).
        </p>
      )}
    </div>
  );
}
