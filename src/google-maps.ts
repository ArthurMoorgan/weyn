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
    // Google's script itself can load fine (200 OK) while the API key is
    // still unusable for actually rendering tiles — e.g. no billing account
    // on the Cloud project, a domain-restricted key hit from the wrong
    // origin, etc. Those failures show up later, as a runtime auth error via
    // this global callback, not as a script-load error — without handling
    // it we'd resolve "success" and then Google paints its own "This page
    // can't load Google Maps correctly" dialog over a broken grey map for
    // every real visitor. Treat it the same as a failed load so callers
    // fall back to the free OSM map instead.
    (window as any).gm_authFailure = () => {
      reject(new Error("Google Maps auth/billing error — see https://developers.google.com/maps/documentation/javascript/error-messages"));
    };
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
