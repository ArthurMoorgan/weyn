// Lazy-loads the Google Maps JS API (places library) once, only if a key is
// configured. Nothing else in the app depends on Google Maps being present —
// MapPicker/MiniMap fall back to free OpenStreetMap search/tiles without it.

export const GOOGLE_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() || "";

let loadPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> | null {
  if (!GOOGLE_MAPS_KEY) return null;
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if ((window as any).google?.maps?.places) {
      resolve((window as any).google);
      return;
    }
    // With `loading=async`, the bootstrap script's `onload` fires before the
    // `places` sub-library has actually finished loading — resolving there
    // races google.maps.places into existence. Use Google's own ready
    // callback instead, which only fires once the requested libraries (place
    // among them) are genuinely available.
    const cbName = "__weynGoogleMapsReady";
    (window as any)[cbName] = () => {
      delete (window as any)[cbName];
      resolve((window as any).google);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&libraries=places&loading=async&callback=${cbName}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  });
  return loadPromise;
}
