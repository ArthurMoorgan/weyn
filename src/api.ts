// Frontend API client — talks to the real Express backend via the Vite proxy.
import { getSessionToken } from "./store";

export type Cat = "sports" | "music" | "food" | "culture" | "cars" | "workshop" | "community";
export type TicketingType = "weyn" | "external" | "cash" | "registration";

export interface Tier {
  id: string;
  name: string;      // "General", "VIP", "Early Bird"…
  price: number;     // OMR
  capacity: number;
  sold: number;
}

export interface Weyn {
  id: string;
  title: string;
  organizer: string;
  cat: Cat;
  startsAt: string;       // ISO
  endsAt: string | null;
  venue: string;
  area: string;
  lat: number;
  lng: number;
  distanceKm: number;
  price: number;          // OMR, 0 = free
  capacity: number;
  sold: number;
  image: string | null;   // /uploads/xxx or null
  color: string;
  glyph: string;
  blurb: string;
  tags: string[];
  refundPolicy: string;
  minAge: number;
  cancelled?: boolean;
  ticketingType: TicketingType;
  externalTicketUrl: string | null;
  organizerContact: string | null;
  tiers?: Tier[];         // multiple ticket types (weyn ticketing only)
  sourceUrl?: string | null;
  importedFromInstagram?: boolean;
}

export interface BookingStatus {
  id: string;
  status: "pending" | "paid" | "cancelled" | "expired";
  eventId: string;
  eventTitle: string | null;
}

export interface Attendee {
  name: string | null;
  email: string | null;
  bookedAt: string;
}

export interface GoogleAccount {
  email: string;
  name: string;
  picture: string | null;
  sessionToken?: string | null; // present once real auth (SESSION_SECRET) is configured server-side
}

export interface MarketingCopy {
  instagram: string;
  whatsapp: string;
  telegram: string;
  twitter: string;
  generatedAt: string;
  aiGenerated: boolean;
}

export interface InstagramImportResult {
  title: string;
  blurb: string;
  tags: string[];
  imagePath: string | null;
  sourceUrl: string | null;
  aiParsed: boolean;
}

export interface OrganizerSummary {
  events: Weyn[];
  stats: {
    eventCount: number;
    ticketsSold: number;
    grossRevenue: number;
    netRevenue: number;
    feePaid: number;
  };
}

export const CATS: { key: Cat | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "music", label: "Live music" },
  { key: "sports", label: "Sports" },
  { key: "food", label: "Food" },
  { key: "culture", label: "Culture" },
  { key: "cars", label: "Car meets" },
  { key: "workshop", label: "Workshops" },
  { key: "community", label: "Community" },
];

// API base. Empty in web dev (relative paths use the Vite proxy). For a native
// iOS/Android build there is no proxy, so set VITE_API_BASE to your hosted
// backend URL at build time, e.g. VITE_API_BASE=https://api.weyn.app
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

// Attached to every write/PII-reading request — server/auth.js's requireAuth
// and requireEventOwner check this, not just "did Google verify you once."
function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// make relative /uploads image paths absolute against the backend for native builds
function absMedia<T extends { image?: string | null }>(e: T): T {
  if (API_BASE && e && typeof e.image === "string" && e.image.startsWith("/")) e.image = API_BASE + e.image;
  return e;
}

async function json<T>(res: Response): Promise<T> {
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => ({})) : {};
    // errors come in two shapes: legacy plain string, or the newer
    // { code, message } — handle both rather than assuming one
    const err = (body as any).error;
    const message = typeof err === "string" ? err : err?.message;
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (!isJson) {
    // most common cause: the frontend is calling a URL that doesn't reach the
    // real API (e.g. a static host's catch-all route serving index.html back),
    // usually because VITE_API_BASE wasn't set to the deployed backend at build time
    throw new Error(
      `Got a non-JSON response from ${res.url} — the app isn't reaching the backend. ` +
      `Check that VITE_API_BASE was set to your deployed API's URL when this build was made.`
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  listEvents(params: { cat?: string; q?: string } = {}): Promise<Weyn[]> {
    const sp = new URLSearchParams();
    if (params.cat && params.cat !== "all") sp.set("cat", params.cat);
    if (params.q) sp.set("q", params.q);
    const qs = sp.toString();
    return fetch(`${API_BASE}/api/events${qs ? "?" + qs : ""}`).then((r) => json<Weyn[]>(r)).then((l) => l.map(absMedia));
  },
  getEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}`).then((r) => json<Weyn>(r)).then(absMedia);
  },
  createEvent(form: FormData): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events`, { method: "POST", headers: authHeaders(), body: form }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  bookEvent(id: string, qty = 1, deviceId?: string, account?: GoogleAccount | null, tierId?: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId }),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  // paid tickets: returns a hosted Thawani checkout URL to redirect to — the
  // ticket isn't actually booked until Thawani confirms payment (see BookingStatus)
  checkoutEvent(id: string, qty = 1, deviceId?: string, account?: GoogleAccount | null, tierId?: string): Promise<{ checkoutUrl: string; bookingId: string }> {
    return fetch(`${API_BASE}/api/events/${id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, origin: window.location.origin }),
    }).then((r) => json(r));
  },
  getBooking(bookingId: string): Promise<BookingStatus> {
    return fetch(`${API_BASE}/api/bookings/${bookingId}`).then((r) => json<BookingStatus>(r));
  },
  registerPush(deviceId: string, token: string, platform: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, token, platform }),
    }).then((r) => json(r));
  },
  organizerSummary(name: string): Promise<OrganizerSummary> {
    return fetch(`${API_BASE}/api/organizer/${encodeURIComponent(name)}/summary`)
      .then((r) => json<OrganizerSummary>(r))
      .then((s) => ({ ...s, events: s.events.map(absMedia) }));
  },
  updateEvent(id: string, patch: Partial<Weyn>): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  cancelEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/cancel`, { method: "POST", headers: authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  duplicateEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/duplicate`, { method: "POST", headers: authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  getAttendees(id: string): Promise<Attendee[]> {
    return fetch(`${API_BASE}/api/events/${id}/attendees`, { headers: authHeaders() }).then((r) => json<Attendee[]>(r));
  },
  googleAuth(idToken: string): Promise<GoogleAccount> {
    return fetch(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }).then((r) => json<GoogleAccount>(r));
  },
  importInstagram(input: { url?: string; caption?: string }): Promise<InstagramImportResult> {
    return fetch(`${API_BASE}/api/import/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(input),
    }).then((r) => json<InstagramImportResult>(r));
  },
  getMarketing(id: string): Promise<MarketingCopy> {
    return fetch(`${API_BASE}/api/events/${id}/marketing`, { headers: authHeaders() }).then((r) => json<MarketingCopy>(r));
  },
  regenerateMarketing(id: string): Promise<MarketingCopy> {
    return fetch(`${API_BASE}/api/events/${id}/marketing/regenerate`, { method: "POST", headers: authHeaders() }).then((r) => json<MarketingCopy>(r));
  },
};

// ---------- derived display helpers ----------
export const ticketsLeft = (e: Weyn) => Math.max(0, e.capacity - e.sold);
export const isSoldOut = (e: Weyn) => e.price >= 0 && e.capacity < 9000 && e.sold >= e.capacity;

export function startDate(e: Weyn) { return new Date(e.startsAt); }

export function isToday(e: Weyn) {
  const d = startDate(e), n = new Date();
  return d.toDateString() === n.toDateString();
}
export function isTonight(e: Weyn) {
  const d = startDate(e), n = new Date();
  return isToday(e) && d.getHours() >= 17 && d.getTime() >= n.getTime() - 3600e3;
}
export function isThisWeekend(e: Weyn) {
  const d = startDate(e), day = d.getDay(); // Fri=5, Sat=6 (Oman weekend)
  const within9 = (d.getTime() - Date.now()) < 9 * 864e5;
  return (day === 5 || day === 6) && within9 && d.getTime() > Date.now() - 864e5;
}

export function dayLabel(e: Weyn): string {
  const d = startDate(e), n = new Date();
  const t = new Date(n); t.setHours(0, 0, 0, 0);
  const ed = new Date(d); ed.setHours(0, 0, 0, 0);
  const diff = Math.round((ed.getTime() - t.getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function timeLabel(e: Weyn): string {
  return startDate(e).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

// group key used for date section headers
export function groupKey(e: Weyn): string {
  const d = startDate(e), n = new Date();
  const t = new Date(n); t.setHours(0, 0, 0, 0);
  const ed = new Date(d); ed.setHours(0, 0, 0, 0);
  const diff = Math.round((ed.getTime() - t.getTime()) / 864e5);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return "This week";
  if (diff < 14) return "Next week";
  return "Later";
}
