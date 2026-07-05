import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Generic async fetcher with loading + error. `deps` re-runs the fetch.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message || "Something went wrong"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

// Plays an exit animation before actually unmounting a sheet/modal, instead
// of it just vanishing. `close()` triggers the CSS "closing" class, waits
// `ms` (matching the CSS transition duration below), then calls the real
// onClose that removes the component from the tree.
export function useClosing(onClose: () => void, ms = 220) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback(() => {
    setClosing(true);
    timer.current = setTimeout(onClose, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, ms]);
  return { closing, close };
}
