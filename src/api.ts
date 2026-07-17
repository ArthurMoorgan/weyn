// Frontend API client — talks to the real Express backend via the Vite proxy.
import { getAuthToken, type Account } from "./store";

export type Cat = "sports" | "music" | "food" | "culture" | "workshop" | "community";
export type TicketingType = "weyn" | "external" | "cash" | "registration" | "organizer_payment";

// Cancel flow (see CancelSubscriptionFlow.tsx) — must match server/app.js's
// CANCEL_REASONS / RETENTION_OFFERS sets exactly.
export type CancelReason = "too_expensive" | "not_using" | "missing_feature" | "switching" | "technical_issues" | "temporary" | "other";
export type RetentionOffer = "discount" | "downgrade" | "feature_unlock";

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

export interface Campaign {
  id: string;
  organizerId: string;
  eventId: string | null;
  venueId?: string | null;
  channel: string;
  subject: string | null;
  message: string;
  segment?: VenueSegment | null;
  scheduledFor: string | null;
  sentAt: string | null;
  status: "scheduled" | "sent" | "cancelled";
  recipientCount?: number | null;
  createdAt: string;
}

export interface VenueSegment {
  type: "all" | "tag" | "inactive" | "new";
  tag?: string;
  days?: number;
}

// ---- Venue Marketing Hub: win-back, loyalty, UTM links, calendar, brand kit ----
export interface WinBackStats {
  targeted: number;
  converted: number;
  rate: number | null;
  windowDays?: number;
}

export interface VenueLoyaltyTier {
  key: "bronze" | "silver" | "gold";
  label: string;
  minVisits: number;
}

export interface VenueLoyaltyGuest {
  email: string;
  name: string;
  visits: number;
  lastVisit: string;
  tier: "bronze" | "silver" | "gold" | null;
  referralCode: string | null;
  referralCount: number;
}

export interface VenueMarketingLink {
  id: string;
  venueId: string;
  label: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  url: string;
  clicks: number;
  createdAt: string;
}

export interface VenueMarketingCalendarItem {
  id: string;
  kind: "campaign";
  subject: string | null;
  status: "scheduled" | "sent";
  date: string | null;
}

export interface VenueBrandKit {
  venueId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  toneOfVoice: string | null;
}

// ---- venue workflows: the node-graph automation builder ----
export type WFNodeType = "trigger" | "condition" | "action";
export type VenueWorkflowTrigger = "reservation_created" | "reservation_cancelled" | "guest_no_show";
export type VenueConditionField = "partySize" | "guestTag" | "reservationSource" | "reservationNotes";
export type VenueWorkflowAction = "notify_owner" | "tag_guest" | "send_guest_email" | "send_guest_sms";

export interface WFNode {
  id: string;
  type: WFNodeType;
  x: number;
  y: number;
  data: Record<string, any>;
}
export interface WFEdge {
  id: string;
  source: string;
  target: string;
}

export interface VenueWorkflow {
  id: string;
  organizerId: string;
  venueId: string;
  name: string;
  enabled: boolean;
  nodes: WFNode[];
  edges: WFEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  trigger: string;
  reservationId: string | null;
  matchedActions: { nodeId: string; action: string; ok: boolean; error?: string }[];
  status: "success" | "partial" | "failed";
  createdAt: string;
}

// ---- event workflows: organizer-dashboard node-graph automation builder —
// full parity with venue workflows above, against the event/ticketing
// catalog (server/event-workflows.js) instead of reservations/guests. ----
export type EventWorkflowTrigger = "ticket_sold" | "low_inventory" | "event_published" | "waitlist_joined" | "promo_code_used";
export type EventConditionField = "ticketTier" | "quantityRemaining" | "attendeeEmailDomain";
export type EventWorkflowAction = "notify_team" | "send_campaign" | "apply_promo_code" | "add_to_waitlist_priority";

export interface EventWorkflow {
  id: string;
  organizerId: string;
  eventId: string;
  name: string;
  enabled: boolean;
  nodes: WFNode[];
  edges: WFEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface EventWorkflowRun {
  id: string;
  workflowId: string;
  trigger: string;
  bookingId: string | null;
  matchedActions: { nodeId: string; action: string; ok: boolean; error?: string }[];
  status: "success" | "partial" | "failed";
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
  // Caller's effective access to this event — only set by GET /api/dashboard/events.
  myRole?: "OWNER" | "MANAGER" | "STAFF";
  myPermissions?: TeamPermission[];
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

// waitlist.weynevents.com signups — see LandingWaitlistSignup in
// schema.prisma, deliberately separate from the per-event WaitlistEntry
// model used for sold-out tickets.
export interface WaitlistSignup {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  source: string | null;
  createdAt: string;
}

export interface MarketingScheduleItem {
  stage: "T-7" | "T-3" | "T-1" | "Day-of";
  label: string;
  text: string;
  date: string | null;
}

export interface AdVariant {
  headline: string;
  description: string;
}

export interface MarketingCopy {
  instagram: string;
  instagramStory: string;
  whatsapp: string;
  whatsappBroadcast: string;
  telegram: string;
  twitter: string;
  schedule: MarketingScheduleItem[];
  generatedAt: string;
  aiGenerated: boolean;
  // Marketing Hub additions — nullable/optional since older cached rows
  // (generated before this shipped) won't have them until regenerated.
  googleAdVariants?: AdVariant[] | null;
  metaAdVariants?: AdVariant[] | null;
  pressRelease?: string | null;
  influencerDm?: string | null;
}

export interface MarketingLink {
  id: string;
  eventId: string;
  organizerId: string;
  label: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  url: string;
  clicks: number;
  createdAt: string;
}

export interface ReferralCode {
  id: string;
  eventId: string;
  organizerId: string;
  code: string;
  ownerName: string | null;
  ownerEmail: string | null;
  referralCount: number;
  createdAt: string;
}

export interface MarketingCalendarItem {
  eventId: string;
  eventTitle: string;
  stage: "T-7" | "T-3" | "T-1" | "Day-of";
  label: string;
  date: string;
}

export interface BrandKit {
  organizerId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  toneOfVoice: string | null;
}

export interface SocialAccountConnection {
  id: string;
  userId: string | null;
  venueId: string | null;
  provider: string;
  tokenExpiresAt: string | null;
  igBusinessAccountId: string | null;
  pageId: string | null;
  pageName: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface VenueSocialPost {
  id: string;
  venueId: string;
  provider: string;
  externalPostId: string | null;
  copy: { caption: string; imageUrl: string };
  status: "posted" | "failed";
  error: string | null;
  postedAt: string;
}

export interface VenueMarketingContact {
  id: string;
  venueId: string;
  email: string;
  name: string | null;
  subscribed: boolean;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VenueEmailCampaignSend {
  id: string;
  venueId: string;
  subject: string;
  bodyHtml: string;
  recipientCount: number;
  sentAt: string;
}

export interface SocialPost {
  id: string;
  eventId: string;
  organizerId: string;
  provider: string;
  externalPostId: string | null;
  copy: { caption: string; imageUrl: string };
  status: "posted" | "failed";
  error: string | null;
  postedAt: string;
}

export interface MarketingContact {
  id: string;
  organizerId: string;
  email: string;
  name: string | null;
  subscribed: boolean;
  source: string;
  tags: string[];
  birthday: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailCampaignSend {
  id: string;
  organizerId: string;
  eventId: string | null;
  subject: string;
  bodyHtml: string;
  recipientCount: number;
  sentAt: string;
}

export type PersuasionAngle = "scarcity" | "social_proof" | "urgency" | "exclusivity";

export interface AngledCopy {
  instagram?: string;
  whatsapp?: string;
  metaAdVariants?: AdVariant[];
  angle: PersuasionAngle;
  aiGenerated: boolean;
}

export interface GrowthIdea {
  title: string;
  description: string;
}

export interface FreeToolIdea {
  name: string;
  description: string;
  why: string;
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
  salesVelocity?: { last3Days: number; prev3Days: number; trend: number };
  forecast?: { daysToSellout: number; projectedSelloutDate: string } | null;
  benchmark?: { sellThroughRate: number; yourAverageSellThroughRate: number | null };
}

export type TeamRole = "MANAGER" | "STAFF";
export type TeamInviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

export interface TeamMember {
  id: string;
  email: string;
  role: TeamRole;
  status: TeamInviteStatus;
  permissions: string[];
  user: { id: string; name: string; avatarUrl: string | null } | null;
  createdAt: string;
  acceptedAt: string | null;
}

export const TEAM_PERMISSIONS = ["viewAttendees", "viewFinance", "sendNotifications"] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any> | null;
  createdAt: string;
  actor: { name: string | null; email: string } | null;
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
  status?: string; // "pending" | "confirmed" | "cancelled" | "seated" | "no_show"
  source?: "guest" | "manual";
  createdAt?: string;
}

export interface VenueAnalytics {
  totalReservations: number;
  coversSeated: number;
  noShows: number;
  noShowRate: number | null;
  peakHours: { hour: string; count: number }[];
  byDayOfWeek: number[]; // index 0 (Sun) - 6 (Sat)
}

export interface VenueGuestNote {
  id: string;
  venueId: string;
  guestEmail: string;
  note: string;
  tags: string[];
  updatedAt: string;
}

export interface ManualReservationInput {
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  partySize: number;
  date: string;
  time: string;
  slotId?: string;
  notes?: string;
  status?: "confirmed" | "seated";
}

// ---------- floor plans: table/seat picking ----------
export type FloorPlanMode = "table" | "seat";
export type TableStatus = "available" | "reserved" | "occupied" | "needs_cleaning" | "maintenance";

export interface FloorSeat {
  id: string;
  tableId: string;
  index: number;
  label: string | null;
  status: "available" | "reserved" | "occupied";
}

export interface FloorTable {
  id: string;
  floorPlanId: string;
  sectionId: string | null;
  label: string;
  shape: "rect" | "circle";
  x: number; y: number; width: number; height: number; rotation: number;
  minCapacity: number;
  maxCapacity: number;
  status: TableStatus;
  seats: FloorSeat[];
}

export interface FloorSection {
  id: string;
  floorPlanId: string;
  name: string;
}

export interface FloorPlan {
  id: string;
  venueId: string | null;
  eventId: string | null;
  mode: FloorPlanMode;
  sections: FloorSection[];
  tables: FloorTable[];
}

export interface FloorTableInput {
  id?: string;
  label: string;
  shape: "rect" | "circle";
  x: number; y: number; width: number; height: number; rotation?: number;
  minCapacity: number;
  maxCapacity: number;
  sectionId?: string | null;
  seatCount?: number; // event floor plans in "seat" mode only
}

export interface TableAssignment {
  id: string;
  reservationId: string | null;
  bookingId: string | null;
  date: string;
  time: string;
  partySize: number;
  tables: { table: FloorTable }[];
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

export type VenueWaitlistStatus = "WAITING" | "NOTIFIED" | "CONVERTED" | "EXPIRED" | "CANCELLED";

export interface VenueWaitlistEntry {
  id: string;
  venueId: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  partySize: number;
  requestedDate: string;
  requestedTimeWindow: string;
  notes?: string | null;
  status: VenueWaitlistStatus;
  priority: number;
  notifiedAt?: string | null;
  convertedReservationId?: string | null;
  createdAt: string;
}

export interface VenueWaitlistInput {
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  partySize: number;
  requestedDate: string;
  requestedTimeWindow: string;
  notes?: string;
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

// ---------- Weyn AI agent (Phase 1: tool-calling + approval queue) ----------
export interface AgentAction {
  id: string;
  organizerId: string;
  tool: string;
  args: Record<string, any>;
  reasoning: string;
  status: "proposed" | "approved" | "rejected" | "executed" | "failed";
  result?: Record<string, any> | null;
  error?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  executedAt?: string | null;
}

// Gemini's own {role, parts} turn shape — passed back verbatim each turn so
// tool-call/tool-result turns stay coherent across the conversation. Opaque
// to the frontend beyond that; never rendered directly (see AgentTool's
// separate display-only log).
export type AgentTurn = { role: string; parts: any[] };

export const CATS: { key: Cat | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "music", label: "Live music" },
  { key: "sports", label: "Sports" },
  { key: "food", label: "Food" },
  { key: "culture", label: "Culture" },
  { key: "workshop", label: "Workshops" },
  { key: "community", label: "Community" },
];

// API base. Empty in web dev (relative paths use the Vite proxy). For a native
// iOS/Android build there is no proxy, so set VITE_API_BASE to your hosted
// backend URL at build time, e.g. VITE_API_BASE=https://api.weyn.app
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

// Deliberately permissive (no full RFC 5322) — just enough to catch typos
// like "bob@" or "bob.com" before they hit the invite endpoint and come
// back as a server error a beat later.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (s: string) => EMAIL_RE.test(s.trim());

// Promotion Center: capture ?utm_source/medium/campaign the first time an
// event page loads with them, stash per-eventId in sessionStorage (survives
// the sign-in redirect a first-time visitor goes through before booking),
// and echo them back on whichever booking route the attendee ends up using.
export function captureUtmFromUrl(eventId: string) {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("utm_source");
  const medium = params.get("utm_medium");
  const campaign = params.get("utm_campaign");
  // Marketing Hub referral program: ?ref=CODE, captured alongside utm_*
  // using the same sessionStorage-per-eventId approach so it survives the
  // sign-in redirect a first-time visitor goes through before booking.
  const ref = params.get("ref");
  if (!source && !medium && !campaign && !ref) return;
  try {
    sessionStorage.setItem(`weyn.utm.${eventId}`, JSON.stringify({ utmSource: source, utmMedium: medium, utmCampaign: campaign, refCode: ref }));
  } catch { /* private browsing / storage disabled — attribution is best-effort */ }
}
function getStoredUtm(eventId: string): { utmSource?: string; utmMedium?: string; utmCampaign?: string; refCode?: string } {
  try {
    const raw = sessionStorage.getItem(`weyn.utm.${eventId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

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

// A plain `fetch()` with no AbortSignal waits forever if the server (or the
// DB it talks to) hangs — QA found this exact failure mode on
// duplicateEvent: the request never resolved or rejected, so the calling
// component's busyId/finally never ran either, leaving the button
// permanently disabled with no error shown. Used on the handful of
// one-shot action buttons (duplicate/cancel/publish/save-as-template) most
// exposed to this — not a blanket replacement for every fetch in this file.
async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("This is taking too long — the server may be having trouble. Please try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  minQuantity: number | null;
};

// ---- organizer dashboard: cross-event views ----
export interface OrganizerNeedsAttentionItem {
  type: "manual_review" | "zero_sales" | "waitlist_pending" | "pending_invite" | "selling_fast";
  eventId: string;
  eventTitle: string;
  message: string;
}
export interface OrganizerOverview {
  needsAttention: OrganizerNeedsAttentionItem[];
  nextUpcoming: { id: string; title: string; startsAt: string; sold: number; capacity: number; image: string | null; color: string; glyph: string }[];
  revenueTrend: { date: string; revenue: number }[];
  reputationScore: { score: number; avgSellThroughRate: number | null; avgRating: number | null; feedbackCount: number } | null;
}

export interface OrganizerGoal {
  organizerId: string;
  month: string;
  revenueGoal: number | null;
  attendanceGoal: number | null;
  eventsGoal: number | null;
  followersGoal: number | null;
}

export interface GoalProgress {
  goal: OrganizerGoal | null;
  progress: { revenue: number; attendance: number; eventsCount: number } | null;
}

export interface AutomationRule {
  id: string;
  organizerId: string;
  eventId: string | null;
  name: string;
  trigger: string;
  action: string;
  config: Record<string, any> | null;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface FeedbackSummary {
  entries: { id: string; rating: number | null; npsScore: number | null; comment: string | null; createdAt: string }[];
  avgRating: number | null;
  count: number;
}
export interface OrganizerAttendee {
  key: string;
  email: string | null;
  name: string | null;
  totalSpend: number;
  ticketsBought: number;
  eventsAttended: number;
  lastBookedAt: string;
  tags: string[];
  notes: string;
  loyaltyPoints: number;
}
export interface OrganizerFinance {
  totalRevenue: number;
  netRevenue: number;
  feesPaid: number;
  totalExpenses: number;
  netProfit: number;
  byEvent: { eventId: string; title: string; revenue: number; ticketsSold: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  payoutsLive: boolean;
}

export interface Expense {
  id: string;
  organizerId: string;
  eventId: string | null;
  event: { id: string; title: string } | null;
  category: string;
  amount: number;
  note: string | null;
  date: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  organizerId: string;
  eventId: string | null;
  url: string;
  type: "image" | "video" | "document";
  folder: string | null;
  tags: string[];
  createdAt: string;
}

export interface Sponsor {
  id: string;
  organizerId: string;
  eventId: string | null;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contractUrl: string | null;
  logoUrl: string | null;
  amount: number | null;
  deliverables: string[];
  status: "prospect" | "confirmed" | "delivered";
  impressions: number;
  clicks: number;
  leadsGenerated: number;
  estValue: number;
  roi: number | null;
  createdAt: string;
}

// ---- Check-ins (feature 1) ----
export type CheckInStatus = "VALID" | "DUPLICATE" | "INVALID";
export interface CheckIn {
  id: string;
  eventId: string;
  ticketId: string | null;
  bookingId: string | null;
  scannedAt: string;
  scannedBy: string | null;
  method: string;
  status: CheckInStatus;
}
export interface CheckInSummary {
  total: number;
  checkedIn: number;
  recent: CheckIn[];
}

// ---- Staff shift scheduling (feature 4) ----
export interface EventShift {
  id: string;
  eventId: string;
  teamMemberId: string;
  role: string | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  createdAt: string;
  teamMember?: { id: string; invitedEmail: string; role: TeamRole };
}

// ---- Budget tracking (feature 5) ----
export interface Budget {
  id: string;
  eventId: string;
  category: string;
  allocatedAmount: number;
  currency: string;
  createdAt: string;
  spent?: number;
  remaining?: number;
  overBudget?: boolean;
}

export interface NpsSummary {
  total: number;
  nps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
}

export interface Vendor {
  id: string;
  organizerId: string;
  eventId: string | null;
  category: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contractUrl: string | null;
  paymentStatus: string;
  rating: number | null;
  notes: string | null;
  createdAt: string;
}

export interface MessageTemplate {
  id: string;
  organizerId: string;
  name: string;
  subject: string | null;
  message: string;
  createdAt: string;
}

export const api = {
  // Public, secret-free feature flags — e.g. whether card payments are wired
  // up on this environment. No auth required.
  config(): Promise<{ paymentsEnabled: boolean }> {
    return fetch(`${API_BASE}/api/config`).then((r) => json<{ paymentsEnabled: boolean }>(r));
  },
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
  bookEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string, inviteCode?: string, seatIds?: string[]): Promise<Weyn & { bookingId: string; accessToken: string }> {
    return fetch(`${API_BASE}/api/events/${id}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode, seatIds, ...getStoredUtm(id) }),
    }).then((r) => json<Weyn & { bookingId: string; accessToken: string }>(r)).then(absMedia);
  },
  // paid tickets: returns a hosted Thawani checkout URL to redirect to — the
  // ticket isn't actually booked until Thawani confirms payment (see BookingStatus)
  checkoutEvent(id: string, qty = 1, deviceId?: string, account?: Account | null, tierId?: string, inviteCode?: string, promoCode?: string): Promise<{ checkoutUrl: string; bookingId: string; accessToken?: string }> {
    return fetch(`${API_BASE}/api/events/${id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode, promoCode, ...getStoredUtm(id) }),
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
      body: JSON.stringify({ qty, deviceId, email: account?.email, name: account?.name, tierId, inviteCode, ...getStoredUtm(id) }),
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
  async aiPricingSuggestion(eventId: string): Promise<{ suggestedPrice: number | null; reasoning: string; sampleSize: number }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/pricing-suggestion`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async aiEventSummary(eventId: string): Promise<{ summary: string; stats: { ticketsSold: number; capacity: number; revenue: number } }> {
    return fetch(`${API_BASE}/api/events/${eventId}/ai/summary`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async aiAssistant(message: string, history: { role: "user" | "assistant"; content: string }[]): Promise<{ reply: string }> {
    return fetch(`${API_BASE}/api/organizer/ai/assistant`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ message, history }),
    }).then((r) => json(r));
  },
  async aiInsights(): Promise<{ insights: string }> {
    return fetch(`${API_BASE}/api/organizer/ai/insights`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async aiAgentChat(message: string, history: AgentTurn[]): Promise<{ reply: string; history: AgentTurn[]; proposedActions: AgentAction[] }> {
    return fetch(`${API_BASE}/api/organizer/ai/agent`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ message, history }),
    }).then((r) => json(r));
  },
  async listAgentActions(status?: AgentAction["status"]): Promise<AgentAction[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return fetch(`${API_BASE}/api/organizer/ai/actions${qs}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async approveAgentAction(id: string): Promise<AgentAction> {
    return fetch(`${API_BASE}/api/organizer/ai/actions/${id}/approve`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },
  async rejectAgentAction(id: string): Promise<AgentAction> {
    return fetch(`${API_BASE}/api/organizer/ai/actions/${id}/reject`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
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
    return fetchWithTimeout(`${API_BASE}/api/events/${id}/cancel`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async duplicateEvent(id: string): Promise<Weyn> {
    return fetchWithTimeout(`${API_BASE}/api/events/${id}/duplicate`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  // ---- Event Builder 2.0: drafts, autosave, templates ----
  async autosaveDraft(id: string, patch: Record<string, any>): Promise<Weyn> {
    return fetch(`${API_BASE}/api/events/${id}/draft`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(patch),
    }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async publishEvent(id: string): Promise<Weyn> {
    return fetchWithTimeout(`${API_BASE}/api/events/${id}/publish`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
  },
  async saveAsTemplate(id: string): Promise<Weyn> {
    return fetchWithTimeout(`${API_BASE}/api/events/${id}/save-template`, { method: "POST", headers: await authHeaders() }).then((r) => json<Weyn>(r)).then(absMedia);
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

  // ---- Marketing Hub: UTM link builder ----
  async listMarketingLinks(eventId: string): Promise<MarketingLink[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing-links`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createMarketingLink(eventId: string, input: { label: string; utmSource: string; utmMedium: string; utmCampaign: string }): Promise<MarketingLink> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing-links`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteMarketingLink(eventId: string, linkId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing-links/${linkId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Marketing Hub: referral program ----
  async listReferralCodes(eventId: string): Promise<ReferralCode[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/referral-codes`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createReferralCode(eventId: string, input: { ownerName?: string; ownerEmail?: string }): Promise<ReferralCode> {
    return fetch(`${API_BASE}/api/events/${eventId}/referral-codes`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async referralLeaderboard(eventId: string): Promise<ReferralCode[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/referral-codes/leaderboard`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async deleteReferralCode(eventId: string, codeId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/referral-codes/${codeId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Marketing Hub: cross-event calendar ----
  async marketingCalendar(): Promise<MarketingCalendarItem[]> {
    return fetch(`${API_BASE}/api/organizer/marketing-calendar`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Marketing Hub: brand kit ----
  async getBrandKit(): Promise<BrandKit> {
    return fetch(`${API_BASE}/api/me/brand-kit`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async setBrandKit(input: { logoUrl?: string | null; primaryColor?: string | null; toneOfVoice?: string | null }): Promise<BrandKit> {
    return fetch(`${API_BASE}/api/me/brand-kit`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },

  // ---- Organizer social/email growth suite ----
  async listSocialAccounts(): Promise<SocialAccountConnection[]> {
    return fetch(`${API_BASE}/api/me/social-accounts`, { headers: await authHeaders() }).then((r) => json(r));
  },
  // Not a fetch — this navigates the browser to Meta's OAuth dialog (via
  // our own redirect route, which carries the session cookie), same-origin
  // so the Clerk cookie/session travels with it.
  connectMetaUrl(): string {
    return `${API_BASE}/api/me/social-accounts/meta/connect`;
  },
  async disconnectSocialAccount(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/me/social-accounts/meta/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async postToInstagram(eventId: string, input: { caption: string; confirmRepost?: boolean }): Promise<SocialPost> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/post-to-instagram`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listSocialPosts(eventId: string): Promise<SocialPost[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/social-posts`, { headers: await authHeaders() }).then((r) => json(r));
  },

  async listMarketingContacts(): Promise<MarketingContact[]> {
    return fetch(`${API_BASE}/api/me/marketing-contacts`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async addMarketingContact(input: { email: string; name?: string; birthday?: string }): Promise<MarketingContact> {
    return fetch(`${API_BASE}/api/me/marketing-contacts`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async importMarketingContacts(csv: string): Promise<{ imported: number; skipped: number; total: number }> {
    return fetch(`${API_BASE}/api/me/marketing-contacts/import`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ csv }),
    }).then((r) => json(r));
  },
  async deleteMarketingContact(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/me/marketing-contacts/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  async sendEmailCampaign(eventId: string, input: { subject: string; body: string }): Promise<{ ok: boolean; recipients: number; sent: number; campaign: EmailCampaignSend }> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/send-email-campaign`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listEmailCampaignSends(): Promise<EmailCampaignSend[]> {
    return fetch(`${API_BASE}/api/organizer/email-campaign-sends`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Growth tools ----
  async growthIdeas(eventId: string): Promise<{ ideas: GrowthIdea[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/growth-ideas`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async freeToolIdeas(eventId: string): Promise<{ ideas: FreeToolIdea[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/free-tool-ideas`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async angledCopy(eventId: string, angle: PersuasionAngle): Promise<AngledCopy> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/angled-copy?angle=${angle}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async bulkAdVariants(eventId: string, input: { platform: "google" | "meta"; count: number }): Promise<{ platform: string; variants: AdVariant[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/marketing/bulk-ad-variants?platform=${input.platform}&count=${input.count}`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Venue social/email growth suite (venue-dashboard mirror of the above) ----
  async listVenueSocialAccounts(venueId: string): Promise<SocialAccountConnection[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/social-accounts`, { headers: await authHeaders() }).then((r) => json(r));
  },
  connectVenueMetaUrl(venueId: string): string {
    return `${API_BASE}/api/venues/${venueId}/social-accounts/meta/connect`;
  },
  async disconnectVenueSocialAccount(venueId: string, connId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/social-accounts/meta/${connId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async postVenueToInstagram(venueId: string, input: { caption: string; confirmRepost?: boolean }): Promise<VenueSocialPost> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/post-to-instagram`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listVenueSocialPosts(venueId: string): Promise<VenueSocialPost[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/social-posts`, { headers: await authHeaders() }).then((r) => json(r));
  },

  async listVenueMarketingContacts(venueId: string): Promise<VenueMarketingContact[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-contacts`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async addVenueMarketingContact(venueId: string, input: { email: string; name?: string }): Promise<VenueMarketingContact> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-contacts`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async importVenueMarketingContacts(venueId: string, csv: string): Promise<{ imported: number; skipped: number; total: number }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-contacts/import`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ csv }),
    }).then((r) => json(r));
  },
  async deleteVenueMarketingContact(venueId: string, contactId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-contacts/${contactId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  async sendVenueEmailCampaign(venueId: string, input: { subject: string; body: string }): Promise<{ ok: boolean; recipients: number; sent: number; campaign: VenueEmailCampaignSend }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/send-email-campaign`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listVenueEmailCampaignSends(venueId: string): Promise<VenueEmailCampaignSend[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/email-campaign-sends`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Venue growth tools ----
  async venueGrowthIdeas(venueId: string): Promise<{ ideas: GrowthIdea[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/growth-ideas`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async venueFreeToolIdeas(venueId: string): Promise<{ ideas: FreeToolIdea[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/free-tool-ideas`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async venueAngledCopy(venueId: string, angle: PersuasionAngle): Promise<AngledCopy> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/angled-copy?angle=${angle}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async venueBulkAdVariants(venueId: string, input: { platform: "google" | "meta"; count: number }): Promise<{ platform: string; variants: AdVariant[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing/bulk-ad-variants?platform=${input.platform}&count=${input.count}`, { headers: await authHeaders() }).then((r) => json(r));
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
  async promotionSources(id: string): Promise<{ source: string; bookings: number; tickets: number; revenue: number }[]> {
    return fetch(`${API_BASE}/api/events/${id}/promotion`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- team management ----
  async inviteTeamMember(eventId: string, email: string, role: TeamRole, permissions?: TeamPermission[]): Promise<TeamInviteResult> {
    return fetch(`${API_BASE}/api/events/${eventId}/team/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email, role, permissions }),
    }).then((r) => json(r));
  },
  async listTeam(eventId: string): Promise<TeamMember[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/team`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async revokeTeamMember(eventId: string, memberId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/team/${memberId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async eventAuditLog(eventId: string): Promise<AuditLogEntry[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/audit-log`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async acceptInvite(token: string): Promise<{ ok: boolean; eventId: string; eventTitle: string; role: TeamRole }> {
    return fetch(`${API_BASE}/api/team/invites/${token}/accept`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- venue team management (mirrors the event team methods above) ----
  async inviteVenueTeamMember(venueId: string, email: string, role: TeamRole): Promise<TeamInviteResult> {
    return fetch(`${API_BASE}/api/venues/${venueId}/team/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email, role }),
    }).then((r) => json(r));
  },
  async listVenueTeam(venueId: string): Promise<TeamMember[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/team`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async revokeVenueTeamMember(venueId: string, memberId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/team/${memberId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },
  async acceptVenueInvite(token: string): Promise<{ ok: boolean; venueId: string; venueName: string; role: TeamRole }> {
    return fetch(`${API_BASE}/api/venue-team/invites/${token}/accept`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- check-in ----
  getBookingTickets(bookingId: string, accessToken?: string): Promise<{ code: string; checkedInAt: string | null }[]> {
    const qs = accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : "";
    return fetch(`${API_BASE}/api/bookings/${bookingId}/tickets${qs}`).then((r) => json(r));
  },
  async checkInTicket(code: string, opts?: { method?: "qr" | "manual"; eventId?: string }): Promise<{ ok: boolean; checkedInAt: string }> {
    return fetch(`${API_BASE}/api/tickets/${encodeURIComponent(code)}/checkin`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ method: opts?.method || "qr", eventId: opts?.eventId }),
    }).then((r) => json(r));
  },
  async eventCheckins(eventId: string): Promise<CheckInSummary> {
    return fetch(`${API_BASE}/api/events/${eventId}/checkins`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async transferTicket(code: string, toEmail: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/tickets/${encodeURIComponent(code)}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ toEmail }),
    }).then((r) => json(r));
  },

  // ---- Staff shift scheduling ----
  async listShifts(eventId: string): Promise<EventShift[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/shifts`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createShift(eventId: string, input: { teamMemberId: string; startTime: string; endTime: string; role?: string; notes?: string }): Promise<EventShift> {
    return fetch(`${API_BASE}/api/events/${eventId}/shifts`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteShift(eventId: string, shiftId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/shifts/${shiftId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Budget tracking ----
  async listBudgets(eventId: string): Promise<Budget[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/budgets`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createBudget(eventId: string, input: { category: string; allocatedAmount: number; currency?: string }): Promise<Budget> {
    return fetch(`${API_BASE}/api/events/${eventId}/budgets`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteBudget(eventId: string, budgetId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/budgets/${budgetId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- NPS + AI feedback summary ----
  async feedbackNps(eventId: string): Promise<NpsSummary> {
    return fetch(`${API_BASE}/api/events/${eventId}/feedback/nps`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async summarizeFeedback(eventId: string): Promise<{ summary: string; themes: string[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/feedback/summarize`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- QR flyer/poster ----
  flyerUrl(eventId: string): string {
    return `${API_BASE}/api/events/${eventId}/flyer.svg`;
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
  async adminWaitlistSignups(): Promise<WaitlistSignup[]> {
    return fetch(`${API_BASE}/api/admin/waitlist-signups`, { headers: await authHeaders() }).then((r) => json(r));
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
  async updateVenueProfile(id: string, input: {
    name?: string; description?: string; category?: VenueCategory; venue?: string; area?: string;
    priceRange?: PriceRange | ""; tags?: string[]; coverImage?: File; photos?: File[]; removePhotos?: string[];
  }): Promise<Venue> {
    const form = new FormData();
    if (input.name !== undefined) form.set("name", input.name);
    if (input.description !== undefined) form.set("description", input.description);
    if (input.category !== undefined) form.set("category", input.category);
    if (input.venue !== undefined) form.set("venue", input.venue);
    if (input.area !== undefined) form.set("area", input.area);
    if (input.priceRange !== undefined) form.set("priceRange", input.priceRange);
    if (input.tags !== undefined) form.set("tags", JSON.stringify(input.tags));
    if (input.removePhotos?.length) form.set("removePhotos", JSON.stringify(input.removePhotos));
    if (input.coverImage) form.set("coverImage", input.coverImage);
    for (const f of input.photos || []) form.append("photos", f);
    return fetch(`${API_BASE}/api/venues/${id}`, { method: "PUT", headers: await authHeaders(), body: form }).then((r) => json<Venue>(r));
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
  async updateAttendeeProfile(email: string, patch: { tags?: string[]; notes?: string; loyaltyPoints?: number }): Promise<{ tags: string[]; notes: string; loyaltyPoints: number }> {
    return fetch(`${API_BASE}/api/organizer/attendees/profile`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ email, ...patch }),
    }).then((r) => json(r));
  },
  async organizerFinance(): Promise<OrganizerFinance> {
    return fetch(`${API_BASE}/api/organizer/finance`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async listExpenses(eventId?: string): Promise<Expense[]> {
    return fetch(`${API_BASE}/api/organizer/expenses${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createExpense(input: { category: string; amount: number; note?: string; eventId?: string; date?: string }): Promise<Expense> {
    return fetch(`${API_BASE}/api/organizer/expenses`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteExpense(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/expenses/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- File Library ----
  async listFiles(eventId?: string): Promise<MediaAsset[]> {
    return fetch(`${API_BASE}/api/organizer/files${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async addFile(input: { url: string; type?: "image" | "video" | "document"; folder?: string; eventId?: string }): Promise<MediaAsset> {
    return fetch(`${API_BASE}/api/organizer/files`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteFile(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/files/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Sponsor management ----
  async listSponsors(eventId?: string): Promise<Sponsor[]> {
    return fetch(`${API_BASE}/api/organizer/sponsors${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async addSponsor(input: { name: string; eventId?: string; contactEmail?: string; contactPhone?: string; amount?: number }): Promise<Sponsor> {
    return fetch(`${API_BASE}/api/organizer/sponsors`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async updateSponsorStatus(id: string, status: Sponsor["status"]): Promise<Sponsor> {
    return fetch(`${API_BASE}/api/organizer/sponsors/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ status }),
    }).then((r) => json(r));
  },
  async updateSponsorRoi(id: string, patch: { impressions?: number; clicks?: number; leadsGenerated?: number }): Promise<Sponsor> {
    return fetch(`${API_BASE}/api/organizer/sponsors/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(patch),
    }).then((r) => json(r));
  },
  async deleteSponsor(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/sponsors/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Vendor management ----
  async listVendors(eventId?: string): Promise<Vendor[]> {
    return fetch(`${API_BASE}/api/organizer/vendors${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async addVendor(input: { name: string; category: string; eventId?: string; contactEmail?: string; contactPhone?: string }): Promise<Vendor> {
    return fetch(`${API_BASE}/api/organizer/vendors`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async updateVendorStatus(id: string, paymentStatus: string): Promise<Vendor> {
    return fetch(`${API_BASE}/api/organizer/vendors/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ paymentStatus }),
    }).then((r) => json(r));
  },
  async deleteVendor(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/vendors/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Message templates ----
  async listMessageTemplates(): Promise<MessageTemplate[]> {
    return fetch(`${API_BASE}/api/organizer/message-templates`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createMessageTemplate(input: { name: string; subject?: string; message: string }): Promise<MessageTemplate> {
    return fetch(`${API_BASE}/api/organizer/message-templates`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async deleteMessageTemplate(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/message-templates/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Feedback Center ----
  async submitFeedback(eventId: string, input: { rating?: number; npsScore?: number; comment?: string; bookingId?: string }): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/events/${eventId}/feedback`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listFeedback(eventId: string): Promise<FeedbackSummary> {
    return fetch(`${API_BASE}/api/events/${eventId}/feedback`, { headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- Organizer Goals ----
  async goalProgress(month: string): Promise<GoalProgress> {
    return fetch(`${API_BASE}/api/organizer/goals/${month}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async setGoal(month: string, patch: Partial<Pick<OrganizerGoal, "revenueGoal" | "attendanceGoal" | "eventsGoal" | "followersGoal">>): Promise<OrganizerGoal> {
    return fetch(`${API_BASE}/api/organizer/goals/${month}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(patch),
    }).then((r) => json(r));
  },

  // ---- Automation Builder ----
  async listAutomations(eventId?: string): Promise<AutomationRule[]> {
    return fetch(`${API_BASE}/api/organizer/automations${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createAutomation(input: { name: string; trigger: string; action: string; eventId?: string; config?: Record<string, any> }): Promise<AutomationRule> {
    return fetch(`${API_BASE}/api/organizer/automations`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationRule> {
    return fetch(`${API_BASE}/api/organizer/automations/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ enabled }),
    }).then((r) => json(r));
  },
  async deleteAutomation(id: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/organizer/automations/${id}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
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
    status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pausedUntil: string | null;
    features: Record<string, boolean>;
    paymentHistory: { id: string; amountOmr: number; status: string; paidAt: string | null; createdAt: string }[];
  }> {
    return fetch(`${API_BASE}/api/me/subscription`, { headers: await authHeaders() }).then((r) => json(r));
  },
  // ---- Cancel flow ----
  async cancelSubscription(reason: CancelReason, feedback?: string): Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }> {
    return fetch(`${API_BASE}/api/me/subscription/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ reason, feedback }),
    }).then((r) => json(r));
  },
  async acceptRetentionOffer(reason: CancelReason, offer: RetentionOffer, feedback?: string): Promise<{ ok: true; offer: RetentionOffer }> {
    return fetch(`${API_BASE}/api/me/subscription/save`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ reason, offer, feedback }),
    }).then((r) => json(r));
  },
  async pauseSubscription(reason: CancelReason, months: number, feedback?: string): Promise<{ status: string; pausedUntil: string | null }> {
    return fetch(`${API_BASE}/api/me/subscription/pause`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ reason, months, feedback }),
    }).then((r) => json(r));
  },
  async resumeSubscription(): Promise<{ status: string }> {
    return fetch(`${API_BASE}/api/me/subscription/resume`, { method: "POST", headers: await authHeaders() }).then((r) => json(r));
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
  async createPromoCode(eventId: string, input: { code: string; discountType: "percent" | "flat"; discountValue: number; maxUses?: number; startsAt?: string; endsAt?: string; minQuantity?: number }): Promise<PromoCode> {
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
  async validatePromoCode(eventId: string, code: string, qty?: number): Promise<{ code: string; discountType: "percent" | "flat"; discountValue: number; minQuantity: number | null }> {
    return fetch(`${API_BASE}/api/promo-codes/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, code, qty }),
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
  async notifyAttendees(eventId: string, input: { subject: string; message: string; scheduledFor?: string }): Promise<{ ok: boolean; scheduled?: boolean; recipients?: number; emailed?: number; pushed?: number }> {
    return fetch(`${API_BASE}/api/events/${eventId}/notify`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async listCampaigns(eventId: string): Promise<Campaign[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/campaigns`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async cancelCampaign(eventId: string, campaignId: string): Promise<Campaign> {
    return fetch(`${API_BASE}/api/events/${eventId}/campaigns/${campaignId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
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
  async venueReservations(venueId: string): Promise<(Reservation & { slot?: VenueAvailabilitySlot | null; tableAssignment?: { tables: { table: FloorTable }[] } | null })[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/reservations`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<(Reservation & { slot?: VenueAvailabilitySlot | null; tableAssignment?: { tables: { table: FloorTable }[] } | null })[]>(r));
  },
  async setVenueSlots(venueId: string, slots: { dayOfWeek: number; startTime: string; endTime: string; capacity: number }[]): Promise<{ slots: VenueAvailabilitySlot[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/slots`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ slots }),
    }).then((r) => json<{ slots: VenueAvailabilitySlot[] }>(r));
  },
  async setReservationStatus(reservationId: string, status: "confirmed" | "cancelled" | "seated" | "no_show"): Promise<Reservation> {
    return fetch(`${API_BASE}/api/reservations/${reservationId}/status`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ status }),
    }).then((r) => json<Reservation>(r));
  },
  async createManualReservation(venueId: string, input: ManualReservationInput): Promise<Reservation> {
    return fetch(`${API_BASE}/api/venues/${venueId}/reservations/manual`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<Reservation>(r));
  },
  // ---- venue reservation waitlist ----
  async joinVenueWaitlist(venueId: string, input: VenueWaitlistInput): Promise<VenueWaitlistEntry> {
    return fetch(`${API_BASE}/api/venues/${venueId}/waitlist`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<VenueWaitlistEntry>(r));
  },
  async venueWaitlist(venueId: string): Promise<VenueWaitlistEntry[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/waitlist`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<VenueWaitlistEntry[]>(r));
  },
  async notifyVenueWaitlistEntry(venueId: string, entryId: string): Promise<VenueWaitlistEntry> {
    return fetch(`${API_BASE}/api/venues/${venueId}/waitlist/${entryId}/notify`, {
      method: "POST", headers: { ...(await authHeaders()) },
    }).then((r) => json<VenueWaitlistEntry>(r));
  },
  async promoteVenueWaitlistEntry(venueId: string, entryId: string, time?: string): Promise<{ entry: VenueWaitlistEntry; reservation: Reservation }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/waitlist/${entryId}/promote`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ time }),
    }).then((r) => json<{ entry: VenueWaitlistEntry; reservation: Reservation }>(r));
  },
  async removeVenueWaitlistEntry(venueId: string, entryId: string): Promise<VenueWaitlistEntry> {
    return fetch(`${API_BASE}/api/venues/${venueId}/waitlist/${entryId}`, {
      method: "DELETE", headers: { ...(await authHeaders()) },
    }).then((r) => json<VenueWaitlistEntry>(r));
  },
  async venueAnalytics(venueId: string): Promise<VenueAnalytics> {
    return fetch(`${API_BASE}/api/venues/${venueId}/analytics`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<VenueAnalytics>(r));
  },
  async venueGuestNotes(venueId: string): Promise<VenueGuestNote[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/guest-notes`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<VenueGuestNote[]>(r));
  },
  async setVenueGuestNote(venueId: string, guestEmail: string, note: string, tags?: string[]): Promise<VenueGuestNote | { deleted: true }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/guest-notes/${encodeURIComponent(guestEmail)}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ note, tags }),
    }).then((r) => json<VenueGuestNote | { deleted: true }>(r));
  },

  // ---- venue marketing: segment-targeted campaigns to a venue's guests ----
  async venueSegmentPreview(venueId: string, segment: VenueSegment): Promise<{ count: number; sample: string[] }> {
    const qs = new URLSearchParams({ type: segment.type, ...(segment.tag ? { tag: segment.tag } : {}), ...(segment.days ? { days: String(segment.days) } : {}) });
    return fetch(`${API_BASE}/api/venues/${venueId}/segment-preview?${qs}`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async createVenueCampaign(venueId: string, input: { subject: string; message: string; segment: VenueSegment; scheduledFor?: string }): Promise<{ ok: true; scheduled: boolean; recipients?: number; emailed?: number; campaign: Campaign }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/campaigns`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json(r));
  },
  async venueCampaigns(venueId: string): Promise<Campaign[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/campaigns`, { headers: await authHeaders() }).then((r) => json<Campaign[]>(r));
  },
  async aiDraftVenueCampaign(venueId: string, goal: string, segmentLabel: string): Promise<{ subject: string; message: string }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/campaigns/ai-draft`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ goal, segmentLabel }),
    }).then((r) => json(r));
  },
  async cancelVenueCampaign(venueId: string, campaignId: string): Promise<Campaign> {
    return fetch(`${API_BASE}/api/venues/${venueId}/campaigns/${campaignId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json<Campaign>(r));
  },
  async venueWinBackStats(venueId: string, campaignId: string, windowDays?: number): Promise<WinBackStats> {
    const qs = windowDays ? `?windowDays=${windowDays}` : "";
    return fetch(`${API_BASE}/api/venues/${venueId}/campaigns/${campaignId}/winback-stats${qs}`, { headers: await authHeaders() }).then((r) => json<WinBackStats>(r));
  },

  // ---- venue marketing hub: loyalty / referral tracking ----
  async venueLoyalty(venueId: string): Promise<{ tiers: VenueLoyaltyTier[]; guests: VenueLoyaltyGuest[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/loyalty`, { headers: await authHeaders() }).then((r) => json(r));
  },
  async issueVenueReferralCode(venueId: string, guestEmail: string): Promise<{ referralCode: string; referralCount: number }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/loyalty/${encodeURIComponent(guestEmail)}/referral-code`, {
      method: "POST", headers: await authHeaders(),
    }).then((r) => json(r));
  },

  // ---- venue marketing hub: UTM link builder ----
  async venueMarketingLinks(venueId: string): Promise<VenueMarketingLink[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-links`, { headers: await authHeaders() }).then((r) => json<VenueMarketingLink[]>(r));
  },
  async createVenueMarketingLink(venueId: string, input: { label: string; utmSource: string; utmMedium: string; utmCampaign: string }): Promise<VenueMarketingLink> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-links`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<VenueMarketingLink>(r));
  },
  async deleteVenueMarketingLink(venueId: string, linkId: string): Promise<{ ok: boolean }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-links/${linkId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json(r));
  },

  // ---- venue marketing hub: cross-campaign calendar ----
  async venueMarketingCalendar(venueId: string): Promise<VenueMarketingCalendarItem[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/marketing-calendar`, { headers: await authHeaders() }).then((r) => json<VenueMarketingCalendarItem[]>(r));
  },

  // ---- venue marketing hub: brand kit ----
  async venueBrandKit(venueId: string): Promise<VenueBrandKit> {
    return fetch(`${API_BASE}/api/venues/${venueId}/brand-kit`, { headers: await authHeaders() }).then((r) => json<VenueBrandKit>(r));
  },
  async setVenueBrandKit(venueId: string, input: { logoUrl?: string | null; primaryColor?: string | null; toneOfVoice?: string | null }): Promise<VenueBrandKit> {
    return fetch(`${API_BASE}/api/venues/${venueId}/brand-kit`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<VenueBrandKit>(r));
  },

  // ---- venue workflows: the node-graph automation builder ----
  async venueWorkflows(venueId: string): Promise<VenueWorkflow[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows`, { headers: await authHeaders() }).then((r) => json<VenueWorkflow[]>(r));
  },
  async createVenueWorkflow(venueId: string, input: { name: string; nodes: WFNode[]; edges: WFEdge[] }): Promise<VenueWorkflow> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<VenueWorkflow>(r));
  },
  async saveVenueWorkflow(venueId: string, workflowId: string, input: { name?: string; nodes?: WFNode[]; edges?: WFEdge[] }): Promise<VenueWorkflow> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows/${workflowId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<VenueWorkflow>(r));
  },
  async setVenueWorkflowEnabled(venueId: string, workflowId: string, enabled: boolean): Promise<VenueWorkflow> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows/${workflowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ enabled }),
    }).then((r) => json<VenueWorkflow>(r));
  },
  async deleteVenueWorkflow(venueId: string, workflowId: string): Promise<{ ok: true }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows/${workflowId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json<{ ok: true }>(r));
  },
  async venueWorkflowRuns(venueId: string, workflowId: string): Promise<WorkflowRun[]> {
    return fetch(`${API_BASE}/api/venues/${venueId}/workflows/${workflowId}/runs`, { headers: await authHeaders() }).then((r) => json<WorkflowRun[]>(r));
  },

  // ---- event workflows: the organizer-dashboard node-graph automation builder ----
  async organizerWorkflows(eventId?: string): Promise<EventWorkflow[]> {
    return fetch(`${API_BASE}/api/organizer/workflows${eventId ? `?eventId=${eventId}` : ""}`, { headers: await authHeaders() }).then((r) => json<EventWorkflow[]>(r));
  },
  async eventWorkflows(eventId: string): Promise<EventWorkflow[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows`, { headers: await authHeaders() }).then((r) => json<EventWorkflow[]>(r));
  },
  async createEventWorkflow(eventId: string, input: { name: string; nodes: WFNode[]; edges: WFEdge[] }): Promise<EventWorkflow> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<EventWorkflow>(r));
  },
  async saveEventWorkflow(eventId: string, workflowId: string, input: { name?: string; nodes?: WFNode[]; edges?: WFEdge[] }): Promise<EventWorkflow> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows/${workflowId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(input),
    }).then((r) => json<EventWorkflow>(r));
  },
  async setEventWorkflowEnabled(eventId: string, workflowId: string, enabled: boolean): Promise<EventWorkflow> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows/${workflowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ enabled }),
    }).then((r) => json<EventWorkflow>(r));
  },
  async deleteEventWorkflow(eventId: string, workflowId: string): Promise<{ ok: true }> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows/${workflowId}`, { method: "DELETE", headers: await authHeaders() }).then((r) => json<{ ok: true }>(r));
  },
  async eventWorkflowRuns(eventId: string, workflowId: string): Promise<EventWorkflowRun[]> {
    return fetch(`${API_BASE}/api/events/${eventId}/workflows/${workflowId}/runs`, { headers: await authHeaders() }).then((r) => json<EventWorkflowRun[]>(r));
  },

  // ---- floor plans: venue side (table/seat picking) ----
  async initVenueFloorPlan(venueId: string, mode: FloorPlanMode = "table"): Promise<FloorPlan> {
    return fetch(`${API_BASE}/api/venues/${venueId}/floor-plan`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ mode }),
    }).then((r) => json<FloorPlan>(r));
  },
  async getVenueFloorPlan(venueId: string): Promise<FloorPlan | null> {
    return fetch(`${API_BASE}/api/venues/${venueId}/floor-plan`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<FloorPlan | null>(r));
  },
  async setVenueFloorPlanMode(venueId: string, mode: FloorPlanMode): Promise<FloorPlan> {
    return fetch(`${API_BASE}/api/venues/${venueId}/floor-plan`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ mode }),
    }).then((r) => json<FloorPlan>(r));
  },
  async addVenueFloorSection(venueId: string, name: string): Promise<FloorSection> {
    return fetch(`${API_BASE}/api/venues/${venueId}/floor-plan/sections`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ name }),
    }).then((r) => json<FloorSection>(r));
  },
  async setVenueFloorTables(venueId: string, tables: FloorTableInput[]): Promise<{ tables: FloorTable[] }> {
    return fetch(`${API_BASE}/api/venues/${venueId}/floor-plan/tables`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ tables }),
    }).then((r) => json<{ tables: FloorTable[] }>(r));
  },
  async setFloorTableStatus(tableId: string, status: TableStatus): Promise<FloorTable> {
    return fetch(`${API_BASE}/api/floor-tables/${tableId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ status }),
    }).then((r) => json<FloorTable>(r));
  },
  async assignTables(reservationId: string, tableIds: string[]): Promise<TableAssignment> {
    return fetch(`${API_BASE}/api/reservations/${reservationId}/assign-tables`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ tableIds }),
    }).then((r) => json<TableAssignment>(r));
  },
  async unassignTables(reservationId: string): Promise<{ ok: true }> {
    return fetch(`${API_BASE}/api/reservations/${reservationId}/assign-tables`, {
      method: "DELETE", headers: { ...(await authHeaders()) },
    }).then((r) => json<{ ok: true }>(r));
  },

  // ---- floor plans: event side (organizer-managed seating for ticketed events) ----
  async initEventFloorPlan(eventId: string, mode: FloorPlanMode = "table"): Promise<FloorPlan> {
    return fetch(`${API_BASE}/api/events/${eventId}/floor-plan`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ mode }),
    }).then((r) => json<FloorPlan>(r));
  },
  async getEventFloorPlan(eventId: string): Promise<FloorPlan | null> {
    return fetch(`${API_BASE}/api/events/${eventId}/floor-plan`, { headers: { ...(await authHeaders()) } })
      .then((r) => json<FloorPlan | null>(r));
  },
  async setEventFloorPlanMode(eventId: string, mode: FloorPlanMode): Promise<FloorPlan> {
    return fetch(`${API_BASE}/api/events/${eventId}/floor-plan`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ mode }),
    }).then((r) => json<FloorPlan>(r));
  },
  async setEventFloorTables(eventId: string, tables: FloorTableInput[]): Promise<{ tables: FloorTable[] }> {
    return fetch(`${API_BASE}/api/events/${eventId}/floor-plan/tables`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ tables }),
    }).then((r) => json<{ tables: FloorTable[] }>(r));
  },
  // Public — no auth — used to render the guest-facing seat picker.
  async eventSeatMap(eventId: string): Promise<FloorPlan> {
    return fetch(`${API_BASE}/api/events/${eventId}/seatmap`).then((r) => json<FloorPlan>(r));
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
