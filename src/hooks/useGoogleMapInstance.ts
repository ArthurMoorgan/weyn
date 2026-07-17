import { useEffect, useRef, useState } from "react";
import { RefObject } from "react";
import { loadGoogleMaps } from "../google-maps";

const MUSCAT_LAT = 23.61;
const MUSCAT_LNG = 58.54;
const DEFAULT_ZOOM = 12;

export function useGoogleMapInstance(
  containerRef: RefObject<HTMLDivElement>,
  initialOptions?: google.maps.MapOptions
) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(initialOptions?.zoom ?? DEFAULT_ZOOM);
  const [currentBounds, setCurrentBounds] = useState<google.maps.LatLngBounds | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      try {
        const g = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;

        if (!g) {
          setError("Google Maps unavailable");
          setLoading(false);
          return;
        }

        const center = initialOptions?.center ?? {
          lat: MUSCAT_LAT,
          lng: MUSCAT_LNG,
        };
        const zoom = initialOptions?.zoom ?? DEFAULT_ZOOM;

        const map = new g.maps.Map(containerRef.current, {
          center,
          zoom,
          ...initialOptions,
        });

        // Track zoom changes
        g.maps.event.addListener(map, "zoom_changed", () => {
          if (cancelled) return;
          setCurrentZoom(map.getZoom() ?? DEFAULT_ZOOM);
        });

        // Track bounds changes
        g.maps.event.addListener(map, "bounds_changed", () => {
          if (cancelled) return;
          setCurrentBounds(map.getBounds() ?? null);
        });

        mapRef.current = map;
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError("Google Maps unavailable");
        setLoading(false);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        // Clear the container to allow proper cleanup
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
        mapRef.current = null;
      }
    };
  }, [containerRef, initialOptions]);

  return {
    map: mapRef.current,
    loading,
    error,
    currentZoom,
    currentBounds,
  };
}
