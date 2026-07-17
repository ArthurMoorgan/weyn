import { useState, useEffect } from "react";

export interface GeolocationCoords {
  lat: number;
  lng: number;
}

export interface UseGeolocationReturn {
  coords: GeolocationCoords | null;
  permission: "granted" | "denied" | "prompt";
  loading: boolean;
  error: string | null;
}

export function useGeolocation(): UseGeolocationReturn {
  const [coords, setCoords] = useState<GeolocationCoords | null>(null);
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt">(
    "prompt"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let watchId: number | null = null;

    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      setLoading(false);
      return;
    }

    const successCallback = (position: GeolocationPosition) => {
      setCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
      setPermission("granted");
      setError(null);
      setLoading(false);
    };

    const errorCallback = (err: GeolocationPositionError) => {
      if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
        setPermission("denied");
        setCoords(null);
        setError(null); // Silent fail for permission denied
      } else {
        const errorMessage =
          err.code === GeolocationPositionError.TIMEOUT
            ? "Geolocation request timed out"
            : "Failed to get geolocation";
        console.error("Geolocation error:", err.message);
        setError(errorMessage);
        setCoords(null);
      }
      setLoading(false);
    };

    watchId = navigator.geolocation.watchPosition(successCallback, errorCallback, {
      timeout: 5000,
      maximumAge: 300000,
    });

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  return { coords, permission, loading, error };
}
