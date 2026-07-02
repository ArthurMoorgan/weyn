import { useSyncExternalStore } from "react";
import type { GoogleAccount } from "./api";

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

// ---- Google account (real identity, once signed in) ----
const ACCOUNT_KEY = "weyn.account";
// The session token is what the backend actually checks on every write route
// (see server/auth.js) — the Google account object alone is just display info.
const SESSION_KEY = "weyn.session";
let account: GoogleAccount | null = read<GoogleAccount | null>(ACCOUNT_KEY, null);
let sessionToken: string | null = localStorage.getItem(SESSION_KEY);
export function setAccount(a: GoogleAccount, token?: string | null) {
  account = a;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  if (token) {
    sessionToken = token;
    localStorage.setItem(SESSION_KEY, token);
  }
  setOrganizer(a.name); // signing in becomes your organizer identity too — no more typing a name that could be anyone's
  emit();
}
export function clearAccount() {
  account = null;
  sessionToken = null;
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(SESSION_KEY);
  emit();
}
export function useAccount(): GoogleAccount | null { return useSyncExternalStore(subscribe, () => account); }
export function getAccount(): GoogleAccount | null { return account; }
export function getSessionToken(): string | null { return sessionToken; }

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
