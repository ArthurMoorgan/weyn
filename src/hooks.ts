import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface UseAsyncOpts {
  /** When provided, opts a call site into the module-level response cache
   *  below. Only pass this for public, shared-across-users data (event
   *  lists, single-event fetches) — never for user-specific or
   *  mutation-adjacent data (bookings, dashboards, saved lists, admin). */
  cacheKey?: string;
  /** Time a cached entry stays fresh, in ms. Defaults to 30s. */
  ttlMs?: number;
}

// Module-level cache shared across component instances/remounts, so
// navigating back to a recently-viewed page can paint instantly instead of
// flashing a loading state, without touching call sites that don't opt in.
const asyncCache = new Map<string, { data: unknown; expiresAt: number }>();
const DEFAULT_TTL_MS = 30_000;

// Generic async fetcher with loading + error. `deps` re-runs the fetch.
// `opts.cacheKey` is additive/opt-in — omitting it (as every existing call
// site does) preserves the exact previous behavior.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts?: UseAsyncOpts): AsyncState<T> {
  const cacheKey = opts?.cacheKey;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const cached = cacheKey ? (asyncCache.get(cacheKey) as { data: T; expiresAt: number } | undefined) : undefined;
  const hasFreshCache = !!cached && cached.expiresAt > Date.now();

  const [data, setData] = useState<T | null>(hasFreshCache ? cached!.data : null);
  const [loading, setLoading] = useState(!hasFreshCache);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let alive = true;

    // Serve a fresh cache hit instantly (no spinner flash), still revalidate
    // in the background so stale data self-heals without user action.
    const freshHit = cacheKey ? (asyncCache.get(cacheKey) as { data: T; expiresAt: number } | undefined) : undefined;
    const isFresh = !!freshHit && freshHit.expiresAt > Date.now();
    if (isFresh) {
      setData(freshHit!.data);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    run()
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (cacheKey) asyncCache.set(cacheKey, { data: d, expiresAt: Date.now() + ttlMs });
      })
      .catch((e) => { if (alive && !isFresh) setError(e.message || "Something went wrong"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, nonce, cacheKey]);

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
