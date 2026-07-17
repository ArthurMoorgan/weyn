import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useUser } from "@clerk/react";

// Per-device UI state: saved events, booked tickets, and the organizer identity.
// Events themselves live in the backend.

const SAVED_KEY = "weyn.saved";
const TICKETS_KEY = "weyn.tickets";
const ORG_KEY = "weyn.organizer";

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "") as T; }
  catch { return fallback; }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

// ---- saved ----
let saved: string[] = read<string[]>(SAVED_KEY, []);
export function toggleSave(id: string) {
  saved = saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id];
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  emit();
}
export function useSaved(): string[] { return useSyncExternalStore(subscribe, () => saved); }
export const isSaved = (id: string) => saved.includes(id);

// ---- tickets the user has booked / RSVP'd ----
// Stores the bookingId/accessToken alongside the eventId, not just the
// eventId — previously this only remembered "you have a ticket for event X"
// with no way to actually fetch that ticket's QR code back (GET
// /api/bookings/:id/tickets needs the bookingId + accessToken, neither of
// which were ever saved). That was the root cause of tickets being
// completely unretrievable after the moment you booked.
export type TicketRecord = { eventId: string; bookingId: string; accessToken?: string };

function readTickets(): TicketRecord[] {
  const raw = read<unknown[]>(TICKETS_KEY, []);
  if (!raw.length) return [];
  // Migrate the old string[]-of-eventIds shape — bookingId is unrecoverable
  // for these, so "View ticket" just won't work for tickets booked before
  // this change (there's no bookingId to have ever been thrown away).
  if (typeof raw[0] === "string") return (raw as string[]).map((eventId) => ({ eventId, bookingId: "" }));
  return raw as TicketRecord[];
}
let tickets: TicketRecord[] = readTickets();
export function addTicket(eventId: string, bookingId: string, accessToken?: string) {
  if (!tickets.some((t) => t.eventId === eventId)) {
    tickets = [{ eventId, bookingId, accessToken }, ...tickets];
    localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets));
    emit();
  }
}
export function useTickets(): TicketRecord[] { return useSyncExternalStore(subscribe, () => tickets); }
export const hasTicket = (id: string) => tickets.some((t) => t.eventId === id);
export const ticketFor = (eventId: string) => tickets.find((t) => t.eventId === eventId);

// ---- anonymous per-install device id (used to target push notifications) ----
const DEVICE_KEY = "weyn.deviceId";
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const DEVICE_SECRET_KEY = "weyn.deviceSecret";
export function getDeviceSecret(): string {
  let secret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
  }
  return secret;
}

// ---- organizer identity (demo) ----
export function getOrganizer(): string { return localStorage.getItem(ORG_KEY) || "You"; }
export function setOrganizer(name: string) { if (name.trim()) localStorage.setItem(ORG_KEY, name.trim()); }

// ---- account (real identity, via Clerk — replaces the old Google Sign-In
// + hand-rolled session JWT). Clerk owns its own client-side session state;
// this just adapts it to the {name,email,picture,role} shape the rest of
// the app already expects, so call sites didn't need a rewrite.
export interface Account {
  id?: string; // Weyn's own User.id (from /api/me), NOT Clerk's user.id — this is what OneSignal.login() targets (see src/push.ts)
  name: string;
  email: string;
  picture: string | null;
  role?: "ATTENDEE" | "ORGANIZER" | "ADMIN"; // fetched separately from /api/me — it's app-side state, not part of Clerk's identity
}

// api.ts needs a real session token for authenticated requests but can't
// call the useAuth() hook itself (it's a plain module, not a component) —
// ClerkAuthBridge (see App.tsx) registers the real getToken() here once
// ClerkProvider has mounted.
type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
export function setTokenGetter(fn: TokenGetter | null) { tokenGetter = fn; }

// Real bug this fixed: a page that mounts and fires an authenticated fetch
// in the same commit ClerkAuthBridge registers the token getter in (very
// common right after sign-in, or when a tab is already active when auth
// resolves) could call getAuthToken() a tick before tokenGetter was set,
// getting back null -> an unauthenticated 401 -> a permanent "Couldn't
// reach the server" error screen, since useAsync only refetches when its
// dependency reference changes again, which isn't guaranteed once the
// account object settles. Polling briefly (instant in the overwhelmingly
// common case — this only ever waits when called in that exact narrow
// window) closes the race at the source instead of patching every call site.
export function getAuthToken(): Promise<string | null> {
  if (tokenGetter) return tokenGetter();
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (tokenGetter) return resolve(tokenGetter());
      if (Date.now() - start > 3000) return resolve(null);
      setTimeout(poll, 50);
    };
    poll();
  });
}

export function useAccount(): Account | null {
  const { user, isLoaded } = useUser();
  const [role, setRole] = useState<Account["role"]>(undefined);
  const [id, setId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!user) { setRole(undefined); setId(undefined); return; }
    let cancelled = false;
    getAuthToken()
      .then((token) => fetch("/api/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (!cancelled) { setRole(me?.role); setId(me?.id); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
  const email = user?.primaryEmailAddress?.emailAddress || "";
  const name = user?.fullName || email || "You";
  const picture = user?.imageUrl || null;
  // Memoized on primitives, not on `user`/`isLoaded` (Clerk gives back new
  // object references on nearly every render) — without this, any caller
  // that puts the returned account object in a useAsync/useEffect deps
  // array (e.g. You.tsx's dashboard fetches) gets a new reference every
  // render, re-triggers its effect, which re-renders, which produces a new
  // reference again: an infinite fetch loop that never lets `loading`
  // settle to false. That reads as a page permanently stuck on its skeleton
  // loader, and disproportionately hits real users (more re-renders, worse
  // network, more likely to trip a rate limiter) versus a dev's warm cache.
  return useMemo(() => {
    if (!isLoaded || !user) return null;
    return { id, name, email, picture, role };
  }, [isLoaded, user, id, name, email, picture, role]);
}

// ---- theme ----
const THEME_KEY = "weyn.theme";
export type Theme = "light" | "dark";
function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
let theme: Theme = initialTheme();
function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#1C1B1A" : "#FFFFFF");
}
apply(theme);
export function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
  apply(theme);
  emit();
}
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => theme); }

// ---- viewport width (used to gate desktop-only surfaces like venue-os) ----
const NARROW_QUERY = "(max-width: 1023px)";
export function useIsNarrowViewport(): boolean {
  const mql = useMemo(() => window.matchMedia?.(NARROW_QUERY), []);
  return useSyncExternalStore(
    (onChange) => {
      if (!mql) return () => {};
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => mql?.matches ?? false,
  );
}
