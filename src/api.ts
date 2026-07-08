// Frontend API client — talks to the real Express backend via the Vite proxy.
import { getAuthToken, type Account } from "./store";

export type Cat = "sports" | "music" | "food" | "culture" | "cars" | "workshop" | "community";
export type TicketingType = "weyn" | "external" | "cash" | "registration" | "organizer_payment";

export interface Tier {
  id: string;
  name: string;      // "General", "VIP", "Early Bird"…
  price: number;     // OMR
  capacity: number;
  sold: number;
  // Advanced ticketing
  kind?: "standard" | "vip" | "group" | "family" | "membership" | "donation";
  minQty?: number | null;
  includesMerch?: boolean;
  hidden?: boolean;
  password?: string | null;
  releaseAt?: string | null;
}

export interface EventVenue {
  id: string;
  organizerId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  parkingAvailable: boolean;
  accessibilityNotes: string | null;
  indoorOutdoor: string | null;
  images: string[];
  notes: string | null;
  contacts: Record<string, any> | null;
  supplierContacts: Record<string, any> | null;
  createdAt: string;
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
  gallery?: string[];      // extra carousel photos beyond the cover image
  imageFocalPoint?: string | null; // "50% 30%" CSS background-position, from Gemini/Groq vision — null = center crop
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
  // "organizer_payment" ticketing only — see prisma schema's comment.
  paymentLinkUrl?: string | null;
  transferDetails?: string | null;
  // Automated reminders, hours-before-start (e.g. [72, 24]) — empty = none.
  // "scheduledAnnouncements" Pro feature, see server's PATCH /api/events/:id.
  reminderSchedule?: number[];
  // Event Builder 2.0
  isDraft?: boolean;
  isTemplate?: boolean;
  draftData?: Record<string, any> | null;
  venueProfileId?: string | null;
  // "customEventThemes" Pro feature — overrides the default purple accent
  // on this event's own detail page. null = app default.
  accentColor?: string | null;
  // Derived server-side from the owner's "reducedWeynBranding" feature —
  // not part of the Event row itself, see GET /api/events/:id.
  hideWeynBranding?: boolean;
  tiers?: Tier[];         // multiple ticket types (weyn ticketing only)
  sourceUrl?: string | null;
  importedFromInstagram?: boolean;
  // Real signals, not yet populated by the backend — the UI supports them so
  // no card redesign is needed once verification/curation exist server-side.
  // Never fabricate these client-side (no fake attendee counts / social proof).
  organizerVerified?: boolean;
  featured?: boolean;
  inviteOnly?: boolean;
  // Never present unless the requester is the event's owner (see GET
  // /api/events/:id) — a signed-out visitor using a shared invite link
  // gets it from the URL itself, not this field.
  inviteCode?: string | null;
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
  bio?: string | null;
  instagram?: string | null;
  website?: string | null;
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
  // Organizer Pro (advancedAnalytics) — present only when the event owner
  // has that feature; absent (not just null) for free-tier events.
  views?: number;
  checkIn?: { total: number; checkedIn: number; rate: number | null };
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

// ---------- venue reservations ----------
export type VenueCategory = "restaurant" | "cafe" | "lounge" | "rooftop" | "beach_club" | "experience";
export type PriceRange = "$" | "$$" | "$$$";

export const VENUE_CATS: { key: VenueCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "restaurant", label: "Restaurant" },
  { key: "cafe", label: "Café" },
  { key: "lounge", label: "Lounge" },
  { key: "rooftop", label: "Rooftop" },
  { key: "beach_club", label: "Beach Club" },
  { key: "experience", label: "Experience" },
];

export interface Venue {
  id: string;
  name: string;
  category: VenueCategory;
  description: string;
  venue: string;       // address string
  area: string;
  lat: number;
  lng: number;
  coverImage: string | null;
  photos: string[];
  priceRange: PriceRange;
  tags: string[];
  verified: boolean;
  subscriptionTier?: string | null;
  // Present in the raw Prisma row (server orders /api/venues by this
  // already) but not declared until now — added so the client can use it
  // as a real "recently added" / trending-tiebreak signal instead of
  // fabricating one.
  createdAt?: string;
}

export interface VenueAvailabilitySlot {
  id?: string;
  dayOfWeek: number; // 0-6
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  capacity: number;
}

export interface VenueDetailResponse extends Venue {
  slots: VenueAvailabilitySlot[];
}

export interface VenueListResponse {
  venues: Venue[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Reservation {
  id: string;
  venueId: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  partySize: number;
  date: string;
  time: string;
  slotId?: string | null;
  notes?: string | null;
  status?: string;
  createdAt?: string;
}

export interface VenueApplication {
  id: string;
  businessType: VenueCategory;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  description?: string | null;
  venue?: string | null;
  area?: string | null;
  coverImage?: string | null;
  photos?: string[];
  guestTags?: string[];
  priceRange?: string | null;
  subscriptionTier?: string | null;
  role?: string | null;
  businessRegNo?: string | null;
  proofDocUrl?: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote?: string | null;
  resultingVenueId?: string | null;
  createdAt: string;
}

export interface ReservationInput {
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  partySize: number;
  date: string;
  time: string;
  slotId?: string;
  notes?: string;
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
function absMedia<T extends { image?: string | null; gallery?: string[] }>(e: T): T {
  if (API_BASE && e && typeof e.image === "string" && e.image.startsWith("/")) e.image = API_BASE + e.image;
  if (API_BASE && e && Array.isArray(e.gallery)) {
    e.gallery = e.gallery.map((g) => (typeof g === "string" && g.startsWith("/") ? API_BASE + g : g));
  }
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

export type PromoCode = {
  id: string; code: string; discountType: "percent" | "flat"; discountValue: number;
  maxUses: number | null; usedCount: number; startsAt: string | null; endsAt: string | null; active: boolean;
};

// ---- organizer dashboard: cross-event views ----
export interface OrganizerNeedsAttentionItem {
  type: "manual_review" | "zero_sales" | "waitlist_pending" | "pending_invite";
  eventId: string;
  eventTitle: string;
  message: string;
}
export interface OrganizerOverview {
  needsAttention: OrganizerNeedsAttentionItem[];
  nextUpcoming: { id: string; title: string; startsAt: string; sold: number; capacity: number; image: string | null; color: string; glyph: string }[];
  revenueTrend: { date: string; revenue: number }[];
}
export interface OrganizerAttendee {
  key: string;
  email: string | null;
  name: string | null;
  totalSpend: number;
  ticketsBought: number;
  eventsAttended: number;
  lastBookedAt: string;
}
export interface OrganizerFinance {
  totalRevenue: number;
  netRevenue: number;
  feesPaid: number;
  byEvent: { eventId: string; title: string; revenue: number; ticketsSold: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  payoutsLive: boolean;
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
  // The server actually returns bookingId/accessToken merged in alongside
  // the event (see server/app.js's POST /api/events/:id/book) — the type
  // here previously said Promise<Weyn>, silently hiding them, which is
  // exactly why free RSVPs had a bookingId to persist but never did.
  bookEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string, inviteCode?: string): Promise<Weyn & { bookingId: string; accessToken: string }> {
    return fetch(`${API_BASE}/api/events/${id}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode }),
    }).then((r) => json<Weyn & { bookingId: string; accessToken: string }>(r)).then(absMedia);
  },
  // paid tickets: returns a hosted Thawani checkout URL to redirect to — the
  // ticket isn't actually booked until Thawani confirms payment (see BookingStatus)
  checkoutEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string, inviteCode?: string): Promise<{ checkoutUrl: string; bookingId: string; accessToken?: string }> {
    return fetch(`${API_BASE}/api/events/${id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode }),
    }).then((r) => json(r));
  },
  getBooking(bookingId: string): Promise<BookingStatus> {
    return fetch(`${API_BASE}/api/bookings/${bookingId}`).then((r) => json<BookingStatus>(r));
  },
  // "organizer_payment" ticketing — returns either the organizer's own
  // payment link or our hosted transfer-instructions page to redirect to.
  // Requires an email (unlike free RSVP) since the ticket can only be
  // delivered once the organizer manually confirms, sometime after this call.
  organizerPaymentCheckout(id: string, qty = 1, deviceId: string | undefined, account: Account | null | undefined, tierId?: string, inviteCode?: string): Promise<{ bookingId: string; accessToken: string; redirectUrl: string }> {
    return fetch(`${API_BASE}/api/events/${id}/organizer-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode }),
    }).then((r) => json(r));
  },
  getOrganizerPaymentBooking(bookingId: string, accessToken: string): Promise<{
    eventTitle: string; amount: number; transferDetails: string | null; status: string; claimedPaidAt: string | null;
  }> {
    return fetch(`${API_BASE}/api/bookings/${bookingId}/organizer-payment?accessToken=${encodeURIComponent(accessToken)}`).then((r) => json(r));
  },
  claimPaymentSent(bookingId: string, accessToken: string): Promise<{ ok: boolean; alreadyPaid?: boolean }> {
    return fetch(`${API_BASE}/api/bookings/${bookingId}/claim-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    }).then((r) => json(r));
  },
  async listPendingPayments(eventId: string): Promise<{ id: string; email: string | null; name: string | null; qty: number; tierName: string | null; amount: number; bookedAt: string; claimedPaidAt: string | null }[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/pending-payments`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async confirmBookingPayment(eventId: string, bookingId: string): Promise<{ id: string; status: string }> {
    return fetch(`${API_BASE}/api/events/${eventId}/bookings/${bookingId}/confirm-payment`, {
      method: "POST", headers: await authHeaders(),
    }).then((r) => json(r));
  },
  // ---- organizer-wide team (bulk per-event invites, see server db comment) ----
  async listOrganizerTeam(): Promise<{ email: string; name: string | null; role: TeamRole; hasPending: boolean; eventCount: number }[]> {
    return fetch(`${API_BASE}/api/organizer/team`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async inviteOrganizerTeam(email: string, role: TeamRole): Promise<{ ok: boolean; eventCount: number }> {
    return fetch(`${API_BASE}/api/organizer/team/invite`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email, role }),
    }).then((r) => json(r));
  },
  async revokeOrganizerTeam(email: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/team/${encodeURIComponent(email)}`, {
      method: "DELETE", headers: await authHeaders(),
    }).then((r) => json(r));
  },
  // ---- AI Studio ----
  async aiDescription(eventId: string, notes: string): Promise<{ description: string }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/description`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ notes }),
    }).then((r) => json(r));
  },
  async aiCoverConcept(eventId: string): Promise<{ concepts: { name: string; description: string; palette: string[] }[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/cover-concept`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async aiPricingSuggestion(eventId: string): Promise<{ suggestedPrice: number | null; reasoning: string; sampleSize: number }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/pricing-suggestion`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async aiEventSummary(eventId: string): Promise<{ summary: string; stats: { ticketsSold: number; capacity: number; revenue: number } }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/summary`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  registerPush(deviceId: string, deviceSecret: string, token: string, platform: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceSecret, token, platform }),
    }).then((r) => json(r));
  },
  async contactSupport(input: { subject: string; message: string }): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/support`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteAccount(): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/me`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  getVapidPublicKey(): Promise<{ publicKey: string | null }> {
    return fetch(`${API_BASE}/api/push/vapid-public-key`).then((r) => json(r));
  },
  async webPushSubscribe(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/push/web-subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ subscription }),
    }).then((r) => json(r));
  },
  async webPushUnsubscribe(endpoint: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/push/web-unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ endpoint }),
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
  // ---- Event Builder 2.0: drafts, autosave, templates ----
  async autosaveDraft(id: string, patch: Record<string, any>): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/draft`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(patch),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async publishEvent(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/publish`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async saveAsTemplate(id: string): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/save-template`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async listTemplates(): Promise<Weyn[]> {
    return fetch(`${API_BASE}/api/organizer/templates`, { headers: await authHeaders() }).then((r) => json<Weyn[]>(r)).then((l) => l.map(absMedia));
  },
  // ---- Venue Management library ----
  async listEventVenues(): Promise<EventVenue[]> {
    return fetch(`${API_BASE}/api/organizer/venues`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createEventVenue(input: Partial<EventVenue>): Promise<EventVenue> {
    return fetch(`${API_BASE}/api/organizer/venues`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async updateEventVenue(id: string, patch: Partial<EventVenue>): Promise<EventVenue> {
    return fetch(`${API_BASE}/api/organizer/venues/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(patch),
    }).then((r) => json(r));
  },
  async deleteEventVenue(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/venues/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async venueRecommendation(id: string): Promise<{ recommendation: string }> {
    return fetch(`${API_BASE}/api/organizer/venues/${id}/recommendation`, { headers: await authHeaders() }).then((r) => json(r));
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
      body: JSON.stringify({ email, role }),
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
  getBookingTickets(bookingId: string, accessToken?: string): Promise<{ code: string; checkedInAt: string | null }[]> {
    const qs = accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : "";
    return fetch(`${API_BASE}/api/bookings/${bookingId}/tickets${qs}`).then((r) => json(r));
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

  // ---- venue reservations ----
  listVenues(params: { category?: string; q?: string; page?: number; limit?: number } = {}): Promise<VenueListResponse> {
    const sp = new URLSearchParams();
    if (params.category && params.category !== "all") sp.set("category", params.category);
    if (params.q) sp.set("q", params.q);
    if (params.page) sp.set("page", String(params.page));
    if (params.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return fetch(`${API_BASE}/api/venues${qs ? "?" + qs : ""}`).then((r) => json<VenueListResponse>(r));
  },
  getVenue(id: string): Promise<VenueDetailResponse> {
    return fetch(`${API_BASE}/api/venues/${id}`).then((r) => json<VenueDetailResponse>(r));
  },
  createReservation(venueId: string, input: ReservationInput): Promise<Reservation> {
    return fetch(`${API_BASE}/api/venues/${venueId}/reservations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }).then((r) => json<Reservation>(r));
  },
  async createVenue(input: {
    name: string; category: VenueCategory; description?: string; venue: string; area: string;
    lat: number; lng: number; coverImage?: string; photos?: string[]; priceRange?: PriceRange;
    tags?: string[]; subscriptionTier?: string;
  }): Promise<Venue> {
    return fetch(`${API_BASE}/api/venues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json<Venue>(r));
  },
  // Reservation hosting is manual-review, not self-serve — this submits an
  // application (see prisma's VenueApplication model), not a live Venue.
  // The backend accepts an anonymous applicantId, but HostVenue.tsx gates
  // this behind sign-in so contactName/contactEmail can be attributed to a
  // real account (needed for the approval email + future push). Auth header
  // attached so the application is linked to the applicant's account.
  // multipart — carries the mandatory ownership-proof document + optional
  // cover/gallery photos alongside the text fields.
  async applyForVenue(input: {
    businessType: VenueCategory; name: string; contactName: string; contactEmail: string;
    contactPhone?: string; description?: string; venue?: string; area?: string;
    lat?: number; lng?: number; guestTags?: string[]; priceRange?: PriceRange;
    subscriptionTier?: string; role: "owner" | "manager" | "authorized"; businessRegNo?: string;
    availability?: { dayOfWeek: number; startTime: string; endTime: string; capacity: number }[];
    proofDoc: File; coverImage?: File; photos?: File[];
  }): Promise<{ id: string; status: string }> {
    const fd = new FormData();
    const scalars: Record<string, unknown> = {
      businessType: input.businessType, name: input.name, contactName: input.contactName,
      contactEmail: input.contactEmail, contactPhone: input.contactPhone, description: input.description,
      venue: input.venue, area: input.area, lat: input.lat, lng: input.lng,
      priceRange: input.priceRange, subscriptionTier: input.subscriptionTier, role: input.role,
      businessRegNo: input.businessRegNo,
    };
    for (const [k, v] of Object.entries(scalars)) if (v !== undefined && v !== null) fd.append(k, String(v));
    fd.append("guestTags", JSON.stringify(input.guestTags || []));
    if (input.availability?.length) fd.append("availability", JSON.stringify(input.availability));
    fd.append("proofDoc", input.proofDoc);
    if (input.coverImage) fd.append("coverImage", input.coverImage);
    for (const p of (input.photos || [])) fd.append("photos", p);
    return fetch(`${API_BASE}/api/venue-applications`, {
      method: "POST", headers: { ...(await authHeaders()) }, body: fd,
    }).then((r) => json<{ id: string; status: string }>(r));
  },

  // ---- organizer dashboard: cross-event views ----
  async organizerOverview(): Promise<OrganizerOverview> {
    return fetch(`${API_BASE}/api/organizer/overview`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async organizerAttendees(): Promise<OrganizerAttendee[]> {
    return fetch(`${API_BASE}/api/organizer/attendees`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async organizerFinance(): Promise<OrganizerFinance> {
    return fetch(`${API_BASE}/api/organizer/finance`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async getOrganizerSettings(): Promise<Record<string, any> | null> {
    return fetch(`${API_BASE}/api/me/organizer-settings`, { headers: await authHeaders() }).then((r) => json(r)).then((d: any) => d.settings);
  },
  async setOrganizerSettings(settings: Record<string, any>): Promise<Record<string, any> | null> {
    return fetch(`${API_BASE}/api/me/organizer-settings`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ settings }),
    }).then((r) => json(r)).then((d: any) => d.settings);
  },

  // ---- Organizer Pro ----
  async mySubscription(): Promise<{
    plan: { key: string; name: string; priceOmr: number; billingPeriod: string };
    status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
    features: Record<string, boolean>;
    paymentHistory: { id: string; amountOmr: number; status: string; paidAt: string | null; createdAt: string }[];
  }> {
    return fetch(`${API_BASE}/api/me/subscription`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async setEventFeatured(eventId: string, featured: boolean): Promise<{ id: string; featured: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/featured`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ featured }),
    }).then((r) => json(r));
  },
  async setEventInviteOnly(eventId: string, inviteOnly: boolean): Promise<{ id: string; inviteOnly: boolean; inviteCode: string | null; inviteUrl: string }> {
    return fetch(`${API_BASE}/api/events/${eventId}/invite-only`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ inviteOnly }),
    }).then((r) => json(r));
  },
  async regenerateInviteCode(eventId: string): Promise<{ id: string; inviteCode: string; inviteUrl: string }> {
    return fetch(`${API_BASE}/api/events/${eventId}/invite-only/regenerate`, {
      method: "POST", headers: await authHeaders(),
    }).then((r) => json(r));
  },
  async listPromoCodes(eventId: string): Promise<PromoCode[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/promo-codes`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createPromoCode(eventId: string, input: { code: string; discountType: "percent" | "flat"; discountValue: number; maxUses?: number; startsAt?: string; endsAt?: string }): Promise<PromoCode> {
    return fetch(`${API_BASE}/api/events/${eventId}/promo-codes`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async setPromoCodeActive(eventId: string, codeId: string, active: boolean): Promise<PromoCode> {
    return fetch(`${API_BASE}/api/events/${eventId}/promo-codes/${codeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ active }),
    }).then((r) => json(r));
  },
  async validatePromoCode(eventId: string, code: string): Promise<{ code: string; discountType: "percent" | "flat"; discountValue: number }> {
    return fetch(`${API_BASE}/api/promo-codes/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, code }),
    }).then((r) => json(r));
  },
  attendeesCsvUrl(eventId: string): string {
    return `${API_BASE}/api/events/${eventId}/attendees.csv`;
  },
  async joinWaitlist(eventId: string, input: { email: string; name?: string; deviceId?: string }): Promise<{ id: string }> {
    return fetch(`${API_BASE}/api/events/${eventId}/waitlist`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listWaitlist(eventId: string): Promise<{ id: string; email: string; name: string | null; createdAt: string; notifiedAt: string | null }[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/waitlist`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async notifyAttendees(eventId: string, input: { subject: string; message: string }): Promise<{ ok: boolean; recipients: number; emailed: number; pushed: number }> {
    return fetch(`${API_BASE}/api/events/${eventId}/notify`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async createRecurringEvents(eventId: string, input: { count: number; intervalDays: number }): Promise<{ created: { id: string; startsAt: string }[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/recurring`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  // ---- venue owner dashboard ----
  async myVenues(): Promise<(Venue & { _count?: { reservations: number; slots: number } })[]> {
    return fetch(`${API_BASE}/api/venues/mine`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<(Venue & { _count?: { reservations: number; slots: number } })[]>(r));
  },
  async venueReservations(venueId: string): Promise<(Reservation & { slot?: VenueAvailabilitySlot | null })[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/reservations`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<(Reservation & { slot?: VenueAvailabilitySlot | null })[]>(r));
  },
  async setVenueSlots(venueId: string, slots: { dayOfWeek: number; startTime: string; endTime: string; capacity: number }[]): Promise<{ slots: VenueAvailabilitySlot[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/slots`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ slots }),
    }).then((r) => json<{ slots: VenueAvailabilitySlot[] }>(r));
  },
  async setReservationStatus(reservationId: string, status: "confirmed" | "cancelled"): Promise<Reservation> {
    return fetch(`${API_BASE}/api/reservations/${reservationId}/status`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ status }),
    }).then((r) => json<Reservation>(r));
  },

  // ---- admin: venue-application review ----
  async adminVenueApplications(status = "pending"): Promise<VenueApplication[]> {
    return fetch(`${API_BASE}/api/admin/venue-applications?status=${encodeURIComponent(status)}`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<VenueApplication[]>(r));
  },
  async approveVenueApplication(id: string, note?: string): Promise<{ application: VenueApplication; venue: Venue }> {
    return fetch(`${API_BASE}/api/admin/venue-applications/${id}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ note }),
    }).then((r) => json<{ application: VenueApplication; venue: Venue }>(r));
  },
  async rejectVenueApplication(id: string, note?: string): Promise<VenueApplication> {
    return fetch(`${API_BASE}/api/admin/venue-applications/${id}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ note }),
    }).then((r) => json<VenueApplication>(r));
  },
};

// ---------- derived display helpers ----------
export const ticketsLeft = (e: Weyn) => Math.max(0, e.capacity - e.sold);
export const isSoldOut = (e: Weyn) => e.price >= 0 && e.capacity < 9000 && e.sold >= e.capacity;

export function startDate(e: Weyn) { return new Date(e.startsAt); }

// An event drops out of discovery once it's over. Mirrors the server's
// isOver() filter in server/app.js (kept in sync): effective end is endsAt, or
// startsAt + 3h when no end time is set, so an in-progress event without an
// explicit end stays visible while it's happening. Applied client-side too so
// cached event lists (see useAsync cacheKey) also hide past events across a
// day/session boundary without waiting for a refetch.
export function isPast(e: Weyn): boolean {
  const end = e.endsAt ? new Date(e.endsAt).getTime() : startDate(e).getTime() + 3 * 3600e3;
  return Number.isFinite(end) && end < Date.now();
}

export function isToday(e: Weyn) {
  const d = startDate(e), n = new Date();
  return d.toDateString() === n.toDateString();
}
export function isTomorrow(e: Weyn) {
  const d = startDate(e), t = new Date();
  t.setDate(t.getDate() + 1);
  return d.toDateString() === t.toDateString();
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
