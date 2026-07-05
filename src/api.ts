// Frontend API client — talks to the real Express backend via the Vite proxy.
import { getAuthToken, type Account } from "./store";

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
  imageFocalPoint?: string | null; // "50% 30%" CSS background-position, from Groq vision — null = center crop
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
  // Real signals, not yet populated by the backend — the UI supports them so
  // no card redesign is needed once verification/curation exist server-side.
  // Never fabricate these client-side (no fake attendee counts / social proof).
  organizerVerified?: boolean;
  featured?: boolean;
  ownerId?: string | null; // absent on legacy/seeded events created before real auth existed
  discoveryStatus?: "PENDING_REVIEW" | "APPROVED" | "DISCOVERY_LIMITED" | "MANUAL_REVIEW" | "DISCOVERY_BLOCKED";
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

// Real identity now comes from Clerk — see store.ts's Account/useAccount,
// which this type alias points at so existing call sites (bookEvent,
// checkoutEvent) didn't need their signatures touched.
export type { Account } from "./store";

export interface Collection {
  id: string;
  name: string;
  isPublic: boolean;
  ownerId: string;
  createdAt?: string;
  _count?: { items: number };
}

export interface CollectionDetail {
  id: string;
  name: string;
  isPublic: boolean;
  ownerId: string;
  ownerName: string | null;
  events: Weyn[];
}

export type ReportReason = "SPAM" | "INAPPROPRIATE" | "FRAUD" | "DUPLICATE" | "OTHER";

export interface PlatformMetrics {
  totalUsers: number;
  totalEvents: number;
  totalBookings: number;
  openReports: number;
  totalRevenue: number;
  newUsersThisWeek: number;
  newEventsThisWeek: number;
}

export interface OpenReport {
  id: string;
  entityType: string;
  entityId: string;
  reason: ReportReason;
  note: string | null;
  status: string;
  createdAt: string;
  reporter: { name: string | null; email: string | null } | null;
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

// Public organizer profile — deliberately excludes revenue/booking data
// (see server/db.js's getOrganizerProfile comment for why the old
// name-keyed /api/organizer/:name/summary this replaces was a privacy bug).
export interface OrganizerProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  followerCount: number;
  isFollowing: boolean;
  events: Weyn[];
}

export interface DashboardSummary {
  totalEvents: number;
  upcomingEvents: number;
  totalAttendees: number;
  totalRevenue: number;
  newRegistrationsToday: number;
}

export interface ActivityItem {
  type: "booking" | "audit";
  eventId: string;
  at: string;
  status?: string;
  qty?: number;
  who?: string;
  action?: string;
}

export interface EventAnalytics {
  eventId: string;
  ticketsSold: number;
  capacity: number;
  revenue: number;
  conversionRate: number | null;
  tierBreakdown: { id: string; name: string; sold: number; capacity: number; revenue: number }[];
  salesByDay: { date: string; qty: number }[];
}

export type TeamRole = "MANAGER" | "STAFF";
export type TeamInviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

export interface TeamMember {
  id: string;
  email: string;
  role: TeamRole;
  status: TeamInviteStatus;
  user: { id: string; name: string; avatarUrl: string | null } | null;
  createdAt: string;
  acceptedAt: string | null;
}

export interface TeamInviteResult {
  id: string;
  email: string;
  role: TeamRole;
  inviteLink: string;
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
// and requireEventOwner check this, not just "did Clerk verify you once."
// Async because Clerk's getToken() refreshes short-lived session JWTs behind
// the scenes — there's no synchronous "current token" to read anymore (see
// store.ts's getAuthToken/setTokenGetter bridge).
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
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
  async createEvent(form: FormData): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events`, { method: "POST", headers: await authHeaders(), body: form }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  bookEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId }),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  // paid tickets: returns a hosted Thawani checkout URL to redirect to — the
  // ticket isn't actually booked until Thawani confirms payment (see BookingStatus)
  checkoutEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string): Promise<{ checkoutUrl: string; bookingId: string }> {
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
  async getOrganizerProfile(id: string): Promise<OrganizerProfile> {
    return fetch(`${API_BASE}/api/organizers/${id}`, { headers: await authHeaders() })
      .then((r) => json<OrganizerProfile>(r))
      .then((p) => ({ ...p, events: p.events.map(absMedia) }));
  },
  async updateEvent(id: string, patch: Partial<Weyn>): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(patch),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async cancelEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/cancel`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async duplicateEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/duplicate`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async getAttendees(id: string): Promise<Attendee[]> {
    return fetch(`${API_BASE}/api/events/${id}/attendees`, { headers: await authHeaders() }).then((r) => json<Attendee[]>(r));
  },
  // Identity itself now comes from Clerk — this just returns the app-side
  // fields (role, id) that live in our own DB, e.g. for the admin link.
  async me(): Promise<{ id: string; email: string; name: string; avatarUrl: string | null; role: "ATTENDEE" | "ORGANIZER" | "ADMIN" }> {
    return fetch(`${API_BASE}/api/me`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async importInstagram(input: { url?: string; caption?: string }): Promise<InstagramImportResult> {
    return fetch(`${API_BASE}/api/import/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json<InstagramImportResult>(r));
  },
  async getMarketing(id: string): Promise<MarketingCopy> {
    return fetch(`${API_BASE}/api/events/${id}/marketing`, { headers: await authHeaders() }).then((r) => json<MarketingCopy>(r));
  },
  async regenerateMarketing(id: string): Promise<MarketingCopy> {
    return fetch(`${API_BASE}/api/events/${id}/marketing/regenerate`, { method: "POST", headers: await authHeaders() }).then((r) => json<MarketingCopy>(r));
  },

  // ---- organizer dashboard ----
  async dashboardSummary(): Promise<DashboardSummary> {
    return fetch(`${API_BASE}/api/dashboard/summary`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async dashboardActivity(): Promise<ActivityItem[]> {
    return fetch(`${API_BASE}/api/dashboard/activity`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async dashboardEvents(): Promise<Weyn[]> {
    return fetch(`${API_BASE}/api/dashboard/events`, { headers: await authHeaders() }).then((r) => json<Weyn[]>(r)).then((l) => l.map(absMedia));
  },
  async eventAnalytics(id: string): Promise<EventAnalytics> {
    return fetch(`${API_BASE}/api/events/${id}/analytics`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- team management ----
  async inviteTeamMember(eventId: string, email: string, role: TeamRole): Promise<TeamInviteResult> {
    return fetch(`${API_BASE}/api/events/${eventId}/team/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email, role, origin: window.location.origin }),
    }).then((r) => json(r));
  },
  async listTeam(eventId: string): Promise<TeamMember[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/team`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async revokeTeamMember(eventId: string, memberId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/team/${memberId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async acceptInvite(token: string): Promise<{ ok: boolean; eventId: string; eventTitle: string; role: TeamRole }> {
    return fetch(`${API_BASE}/api/team/invites/${token}/accept`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- check-in ----
  getBookingTickets(bookingId: string): Promise<{ code: string; checkedInAt: string | null }[]> {
    return fetch(`${API_BASE}/api/bookings/${bookingId}/tickets`).then((r) => json(r));
  },
  async checkInTicket(code: string): Promise<{ ok: boolean; checkedInAt: string }> {
    return fetch(`${API_BASE}/api/tickets/${encodeURIComponent(code)}/checkin`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- search ----
  searchEvents(q: string, cat?: string): Promise<Weyn[]> {
    const sp = new URLSearchParams({ q });
    if (cat && cat !== "all") sp.set("cat", cat);
    return fetch(`${API_BASE}/api/search?${sp}`).then((r) => json<Weyn[]>(r)).then((l) => l.map(absMedia));
  },

  // ---- following organizers ----
  async followOrganizer(id: string): Promise<{ ok: boolean; followerCount: number }> {
    return fetch(`${API_BASE}/api/organizers/${id}/follow`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async unfollowOrganizer(id: string): Promise<{ ok: boolean; followerCount: number }> {
    return fetch(`${API_BASE}/api/organizers/${id}/follow`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async getFollowStatus(id: string): Promise<{ following: boolean; followerCount: number }> {
    return fetch(`${API_BASE}/api/organizers/${id}/follow`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async followingFeed(): Promise<Weyn[]> {
    return fetch(`${API_BASE}/api/me/following-feed`, { headers: await authHeaders() }).then((r) => json<Weyn[]>(r)).then((l) => l.map(absMedia));
  },

  // ---- collections ----
  async createCollection(name: string): Promise<Collection> {
    return fetch(`${API_BASE}/api/collections`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ name }),
    }).then((r) => json(r));
  },
  async listMyCollections(): Promise<Collection[]> {
    return fetch(`${API_BASE}/api/collections`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async getCollection(id: string): Promise<CollectionDetail> {
    return fetch(`${API_BASE}/api/collections/${id}`, { headers: await authHeaders() }).then((r) => json<CollectionDetail>(r)).then((c) => ({ ...c, events: c.events.map(absMedia) }));
  },
  async renameCollection(id: string, name: string): Promise<CollectionDetail> {
    return fetch(`${API_BASE}/api/collections/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ name }),
    }).then((r) => json(r));
  },
  async deleteCollection(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/collections/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async addToCollection(id: string, eventId: string): Promise<CollectionDetail> {
    return fetch(`${API_BASE}/api/collections/${id}/items`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ eventId }),
    }).then((r) => json(r));
  },
  async removeFromCollection(id: string, eventId: string): Promise<CollectionDetail> {
    return fetch(`${API_BASE}/api/collections/${id}/items/${eventId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- reports + admin ----
  async reportEntity(entityType: "event" | "organizer" | "user", entityId: string, reason: ReportReason, note?: string): Promise<{ id: string }> {
    return fetch(`${API_BASE}/api/reports`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ entityType, entityId, reason, note }),
    }).then((r) => json(r));
  },
  async adminListReports(): Promise<OpenReport[]> {
    return fetch(`${API_BASE}/api/admin/reports`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async adminResolveReport(id: string, status: "REVIEWED" | "DISMISSED" | "ACTIONED"): Promise<OpenReport> {
    return fetch(`${API_BASE}/api/admin/reports/${id}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ status }),
    }).then((r) => json(r));
  },
  async adminMetrics(): Promise<PlatformMetrics> {
    return fetch(`${API_BASE}/api/admin/metrics`, { headers: await authHeaders() }).then((r) => json(r));
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
