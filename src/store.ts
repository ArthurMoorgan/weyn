import { useEffect, useState, useSyncExternalStore } from "react";
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
let tickets: string[] = read<string[]>(TICKETS_KEY, []);
export function addTicket(id: string) {
  if (!tickets.includes(id)) {
    tickets = [id, ...tickets];
    localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets));
    emit();
  }
}
export function useTickets(): string[] { return useSyncExternalStore(subscribe, () => tickets); }
export const hasTicket = (id: string) => tickets.includes(id);

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

// ---- organizer identity (demo) ----
export function getOrganizer(): string { return localStorage.getItem(ORG_KEY) || "You"; }
export function setOrganizer(name: string) { if (name.trim()) localStorage.setItem(ORG_KEY, name.trim()); }

// ---- account (real identity, via Clerk — replaces the old Google Sign-In
// + hand-rolled session JWT). Clerk owns its own client-side session state;
// this just adapts it to the {name,email,picture,role} shape the rest of
// the app already expects, so call sites didn't need a rewrite.
export interface Account {
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
export function getAuthToken(): Promise<string | null> { return tokenGetter ? tokenGetter() : Promise.resolve(null); }

export function useAccount(): Account | null {
  const { user, isLoaded } = useUser();
  const [role, setRole] = useState<Account["role"]>(undefined);
  useEffect(() => {
    if (!user) { setRole(undefined); return; }
    let cancelled = false;
    getAuthToken()
      .then((token) => fetch("/api/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (!cancelled) setRole(me?.role); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
  if (!isLoaded || !user) return null;
  const email = user.primaryEmailAddress?.emailAddress || "";
  return {
    name: user.fullName || email || "You",
    email,
    picture: user.imageUrl || null,
    role,
  };
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
  if (meta) meta.setAttribute("content", t === "dark" ? "#0E1320" : "#FFFFFF");
}
apply(theme);
export function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
  apply(theme);
  emit();
}
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => theme); }
