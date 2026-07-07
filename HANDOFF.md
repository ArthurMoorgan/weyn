# Weyn — Handoff / Continuation Guide
*Last updated: 2026-07-07.*

Read this whole file before touching anything. Large parts of the previous
version of this doc (dated 2026-07-05) were stale — Google Sign-In was fully
replaced by Clerk, PayTabs got real (if unused) integration, the preview
tooling issue was root-caused, and a lot of new product surface shipped.
This version reflects the actual current state.

## 1. What Weyn is now

A real, deployed Muscat/Oman events-discovery, ticketing, and venue-
reservations platform. **weynevents.com** (Vercel) and **app.weynevents.com**
(Cloudflare Worker) are both live, same codebase, same Neon Postgres
database. Clerk handles auth (email+password, username+password, Google
OAuth). Organizers publish events, attendees discover via Explore, book
free/paid tickets with a real QR-code retrieval flow, follow organizers,
save events, and get checked in at the door. Separately, venues (cafes,
restaurants, lounges) can apply to be listed for table reservations — a
human-reviewed application flow, distinct from event ticketing.

**Sign-up is now mandatory app-wide** (see §3) — there is no anonymous
browsing anymore, including shared event links.

## 2. Architecture at a glance

```
dhairya/
├── src/                      React 18 + TypeScript + Vite
│   ├── api.ts                  typed fetch client — every server route has a method here
│   ├── store.ts                 localStorage: saved, tickets (now {eventId,bookingId,accessToken}), theme, account
│   ├── webpush.ts                Web Push (VAPID) subscribe/unsubscribe client helper
│   ├── components/
│   │   ├── AuthGate.tsx           mandatory sign-up/sign-in wall — wraps every route but /onboarding
│   │   ├── TicketSheet.tsx        renders a real scannable QR from a booking's ticket code
│   │   ├── SubscriptionCard.tsx   Organizer Pro dashboard card (plan/renewal/features/billing history)
│   │   ├── UpgradeModal.tsx       Organizer Pro upgrade modal (CTA is inert — no billing wired yet)
│   │   ├── FeatureLock.tsx        Pro-gated UI wrapper — locked state + upgrade CTA
│   │   └── featureCatalog.ts      human-readable labels for the Pro feature flags
│   └── pages/
│       ├── Explore.tsx            discovery feed — Featured/Trending/Tonight/Weekend/category rails
│       ├── EventDetail.tsx        booking + "View ticket" QR retrieval
│       ├── HostVenue.tsx           venue-hosting application wizard (8 steps incl. 3-tier Pro plan picker)
│       ├── Support.tsx            FAQ + contact form (/support)
│       ├── You.tsx                 tabbed profile: Overview/Tickets/Saved/Lists/Organizer/Venues/Settings
│       └── Onboarding.tsx          first-run walkthrough, the one route reachable signed-out
├── server/
│   ├── app.js                    ~95 REST routes, rate-limited, auth-gated
│   ├── db.js                      Prisma-backed data layer
│   ├── auth.js                    Clerk session verification + event-ownership middleware
│   ├── features.js                Organizer Pro feature-gate system — see §4
│   ├── email.js                   Resend — booking confirmations, venue approval/rejection, support, invites
│   ├── push.js                    APNs (native iOS push) — code-complete, NOT configured (no Apple Dev account yet)
│   ├── webpush.js                 Web Push (VAPID) — configured and live on both dev+prod
│   └── moderation.js               trust & safety: rule engine + AI scoring, gates discovery reach only
├── prisma/schema.prisma          Postgres (Neon) schema
└── HANDOFF.md                    this file
```

## 3. Mandatory sign-up (new)

`src/components/AuthGate.tsx` is a layout route wrapping every route except
`/onboarding`. Checks Clerk's real `isSignedIn` — not a localStorage flag —
so a direct deep link (a shared `/e/:id`, a bookmarked `/you`) always hits
it. Real tradeoff: this blocks viewing a shared event link before signing
up, a cost to link-based virality. One-line revert: remove `AuthGate` from
`main.tsx`'s route tree.

Clerk config (both dev and prod instances, via `clerk config patch`, not
app code): username is now a real sign-up/sign-in identifier alongside
email, both backed by password auth. Note: Clerk's default `<SignUp/>` UI
only renders fields with `required_for_sign_up: true` — merely enabling
`used_for_sign_up` isn't enough to make a field appear, which cost real
time to track down.

**Production is still running Clerk's `pk_test_`/`sk_test_` (development
instance) keys.** A `pk_live_` production instance already exists for this
app (`app_3G49KglnXhwSxpbrXMTiIJ1beBB`, discovered via `clerk apps list`)
but nothing points at it yet. Swapping in the live keys is the actual
remaining step before this goes fully production-grade.

## 4. Organizer Pro — monetization layer (new)

### Ship state: every feature, unlocked, for free

Per explicit product direction: event creation/publishing/hosting must
stay completely free with no approval gate, and every Pro feature flag
should be live and usable right now — but no payment processor is wired to
actually charge anyone yet. The mechanism: every organizer is
**auto-granted an ACTIVE subscription to the "pro" plan, free, the first
time it's looked up** (`ensureSubscription()` in `server/features.js`).
This isn't a hardcoded bypass — it exercises the exact same code path real
billing will use later; only the *default plan a new subscription gets
created on* needs to change when billing goes live (see §4.4).

### 4.1 Schema (migration `20260707140000_organizer_pro`)

- `SubscriptionPlan` — plan catalog. Seeded: `free` (0 OMR) and `pro` (15
  OMR/month).
- `Subscription` — one per `User`. `status` enum: `INACTIVE | ACTIVE |
  PAST_DUE | CANCELLED | EXPIRED | SUSPENDED | TRIALING`. Has
  `stripeCustomerId`/`stripeSubscriptionId` columns, both null until real
  billing is wired.
- `FeatureAccess` — **plan-level**, not per-user: `(planId, feature) →
  enabled`. ~28 rows total (one per flag × plan), not one row per
  organizer — this is why `hasFeature()` is cheap to call on every
  request.
- `BillingEvent` — raw provider webhook log. `providerEventId` is
  `@unique`, which is the actual dedup/replay-protection mechanism for
  when Stripe webhooks are wired in (see §4.5).
- `PaymentHistory` — per-subscription payment records.
- `PromoCode`, `WaitlistEntry` — feature-specific tables, see §4.3.
- `Event.featured` — was a dead field on the frontend `Weyn` TypeScript
  type before this (declared, never populated by any server response).
  Now a real column; Explore's existing Featured-rail logic
  (`e.featured` filter) went from always-empty to actually working the
  moment this shipped.
- Deliberately did **not** create a separate `subscription_audit_logs`
  table — subscription state changes reuse the existing generic
  `db.audit()`/`AuditLog` mechanism already used for admin actions, per
  "don't rebuild existing systems."

**Pre-existing DB drift found, deliberately left alone**: the live
database has two trigram search indexes and a `Payment.stripeSessionId`
column that aren't declared anywhere in `schema.prisma` or referenced by
any current code — orphaned from an earlier draft. `prisma migrate diff`
against the live DB will surface these as things it wants to drop; **do
not let it**. The Organizer Pro migration was hand-written specifically to
exclude them, out of scope for this change.

### 4.2 Feature gate (`server/features.js`)

```js
hasFeature(userId, "promoCodes")        // -> boolean, never throws
allFeatures(userId)                     // -> { featureKey: boolean, ... } for all ~28 at once
requireFeature("csvExports")            // Express middleware, 403 FEATURE_LOCKED if not allowed
```

This is the **only** place any code should check subscription/feature
state — nothing else reads `Subscription.status` or `FeatureAccess`
directly. That's the actual abuse-prevention mechanism the original spec
asked for: the flag is resolved server-side, from the database, on every
single check — there's no client-supplied value to trust, so there's
nothing to spoof. A locked feature's routes 403 with a machine-readable
`{code: "FEATURE_LOCKED", feature}` body the frontend can turn into an
upgrade prompt.

One nuance: a few gates check the **event owner's** plan rather than the
requester's — an anonymous attendee joining a waitlist, or a MANAGER-role
team member viewing analytics, has no subscription of their own to check;
what matters is whether the *event* is entitled to that feature.

### 4.3 What's actually built vs. scaffolded

**Fully built, tested against real production data this session:**
- Featured placement / priority ranking / featured badge — `PATCH
  /api/events/:id/featured`, ranking is the pre-existing Featured-rail
  mechanism now fed real data (no new sort logic needed or added).
- Promo codes (covers promoCodes / discountCampaigns / earlyBirdCampaigns
  — one model with a date window, not three separate systems) — full
  CRUD + public validate endpoint.
- CSV export of attendees (`GET /api/events/:id/attendees.csv`).
- Waitlists — join (public, gated on the event owner's plan) + view
  (owner-only).
- Bulk notify attendees — reuses the email/push infra built this session;
  **"send now" only, not true future-dated scheduling** (that's
  `scheduledAnnouncements` as literally specified — not built, see below).
- Recurring events — lightweight: creates N copies spaced by a fixed
  interval, reusing the exact same copy logic as the pre-existing
  `/duplicate` endpoint. Not a real recurrence-rule engine (custom
  weekday patterns, exceptions, "every 2nd Tuesday") — that's real
  additional scope if ever needed.
- Advanced analytics — **extended the existing** `GET
  /api/events/:id/analytics` / `db.eventAnalytics()` rather than building
  a competing endpoint (an earlier draft of this session's work
  accidentally registered a duplicate route at the same path, which would
  have silently shadowed the working basic-analytics endpoint for every
  user — caught before shipping). The existing handler already had a
  `conversionRate: null // needs page-view tracking — not yet
  instrumented` placeholder; filled it in using `event_view` rows that
  were **already being recorded** on every `GET /api/events/:id` via
  `db.track()` — no new client instrumentation needed. Adds `views` and
  `checkIn.rate` for Pro, on top of the same base fields free users
  already had (`ticketsSold`, `revenue`, `tierBreakdown`, `salesByDay`).
- teamMembers / staffPermissions / eventTemplates — these already
  existed before this session (`EventTeamMember` + invite flow, and the
  `/duplicate` endpoint respectively) and needed no new code, only
  registering as flags in the catalog.

**Deliberately NOT built** (flagged honestly rather than faked):
- `trafficSources` (referrer/UTM tracking) and `audienceInsights`
  (demographic breakdown) — no source data exists for either yet.
- `eventComparisonReports` (side-by-side across events) — only a
  single-event view exists.
- True `scheduledAnnouncements` (future-dated sends) — only "send now."
  Would reuse the existing cron-scan pattern (`runReminderScan`) if built.
- `customOrganizerThemes` / `customEventThemes` / `customUrls` /
  `customBranding` / `reducedWeynBranding` — no schema, no code. A real
  theming/branding engine and custom-slug routing are both substantial
  scope on their own; didn't want to ship a half-built version of either.

### 4.4 Frontend

- `SubscriptionCard.tsx` — wired into Profile → Settings. Shows plan,
  status, renewal date (currently "Free during launch — no renewal date
  yet" since every subscription's `currentPeriodEnd` is a placeholder far-
  future date), active feature list, billing history (empty for
  everyone right now, since nothing has ever charged).
- `UpgradeModal.tsx` — real plan/feature display, but the "Upgrade"
  button is `disabled` with a "coming soon" label. There is genuinely
  nothing to upgrade *to* right now since everyone already has every
  feature — this becomes live the moment §4.5 is wired in.
- `FeatureLock.tsx` — locked-state wrapper (Pro badge + lock icon +
  opens `UpgradeModal`). Renders `children` directly whenever the passed
  `enabled` prop is true, which is *every* organizer, *every* feature,
  today — so in practice this never shows its locked state yet. It
  exists so real gating is a prop change away, not new UI.
- **Not yet done**: wiring `FeatureLock`/the concrete Pro endpoints
  (featured toggle, promo code management, CSV export button, notify
  form, recurring-events button) into the actual Organizer per-event
  management screens (`Organizer.tsx`). The backend for all of it is
  live and tested; the dashboard UI to trigger it from is the natural
  next increment.

### 4.5 Stripe integration — architecture, parked (not wired, not deployed)

Per explicit instruction: build this out as an architecture/plan and keep
the code path ready, but do not deploy or connect it to real Stripe keys
yet. **Weyn's existing ticket payments run through PayTabs
(`server/payments.js`), not Stripe** — introducing Stripe here means two
payment processors side by side (PayTabs for one-off ticket purchases,
Stripe for the Pro recurring subscription), which is a deliberate,
confirmed choice, not an oversight: PayTabs has no recurring-billing
primitive to build on, and hand-rolling monthly re-charges/dunning would
be materially riskier than using Stripe's mature Billing product for
exactly the thing it's built for.

**When ready to turn this on:**

1. **Stripe setup** (external, needs a real Stripe account — can't be
   done from here): create a Stripe account, create a Product ("Weyn
   Pro") with a recurring Price (15 OMR/month — note Stripe's OMR support
   should be confirmed; if unsupported, price in USD/AED and convert, or
   use Stripe's multi-currency pricing). Set `STRIPE_SECRET_KEY`,
   `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRO_PRICE_ID` in both Vercel and Cloudflare env (same pattern
   as the `VAPID_*`/`RESEND_API_KEY` secrets already set this session).

2. **Checkout flow**: `POST /api/subscription/checkout` (new,
   `requireAuth`) creates a Stripe Checkout Session in `subscription`
   mode with the Pro price, `customer_email` from `req.user.email`,
   `client_reference_id` = `req.user.id` (this is how the webhook below
   maps a Stripe event back to a Weyn user without trusting anything the
   client sends), `success_url`/`cancel_url` back into the app. Stripe
   Checkout natively supports cards + Apple Pay + Google Pay with zero
   extra integration work — they're payment-method options on the same
   Checkout Session, not separate integrations.

3. **Webhook handler**: `POST /api/webhooks/stripe` (new, raw body —
   Express's `express.raw()` for this route specifically, since Stripe's
   signature check needs the exact byte payload, not JSON-parsed).
   - **Signature verification**: `stripe.webhooks.constructEvent(rawBody,
     signatureHeader, STRIPE_WEBHOOK_SECRET)` — rejects anything not
     actually from Stripe. Non-negotiable; this is the entire security
     boundary for "someone POSTs a fake 'subscription activated' event."
   - **Dedup / replay protection**: before processing, check
     `BillingEvent.providerEventId` (the `@unique` column built for
     exactly this) for the incoming `event.id`. If a row already exists
     with `processedAt` set, return 200 immediately without reprocessing
     — Stripe explicitly documents at-least-once delivery, so a handler
     that isn't idempotent will double-process real events. If no row
     exists, insert one with `processedAt: null` first (so a duplicate
     arriving mid-processing sees the row and backs off), do the actual
     work, then set `processedAt`.
   - **Events to handle**: `checkout.session.completed` (create/update
     the `Subscription` row: `stripeCustomerId`, `stripeSubscriptionId`,
     `status: ACTIVE`, `currentPeriodStart/End` from the session) →
     `customer.subscription.updated` (status changes: `past_due`,
     `canceled`, etc. — map Stripe's states onto the existing
     `SubscriptionStatus` enum) → `invoice.paid` (append a
     `PaymentHistory` row, this is also the natural place to send a
     receipt email via the existing `sendEmail()`) →
     `invoice.payment_failed` (status → `PAST_DUE`, trigger a "payment
     failed" email — Stripe's own retry/dunning schedule handles the
     re-attempts, no need to build that by hand).
   - **Failure recovery**: if processing throws after the dedup row is
     inserted but before `processedAt` is set, the row stays
     `processedAt: null` — a scheduled reconciliation job (or manual
     admin action) can find these and either retry or query Stripe
     directly for the definitive current state and reconcile.
   - **Audit logging**: `db.audit("subscription.webhook", {...})` on every
     processed event, reusing the existing `AuditLog` mechanism —
     consistent with the decision in §4.1 not to build a parallel
     dedicated audit table.

4. **The one line that actually turns Pro into a paid product**:
   `ensureSubscription()` in `server/features.js` currently creates every
   new subscription on the `pro` plan with `status: ACTIVE`. Change the
   default to the `free` plan with `status: INACTIVE`, and let the
   webhook handler above (step 3) be the only thing that ever moves a
   user onto `pro`. Nothing else in `features.js`, and no caller of
   `hasFeature()` anywhere in the codebase, needs to change — this was
   the entire point of building the gate this way.

5. **Expiration handling** (per the original spec's requirement): when a
   subscription's status moves to `CANCELLED`/`EXPIRED`, do **not**
   delete `PromoCode`/`WaitlistEntry`/analytics history/anything else —
   none of that data has a lifecycle tied to subscription status in this
   schema, so nothing needs to change to "preserve" it; it already just
   sits there. What actually changes is `hasFeature()` starts returning
   `false` for that user (their `Subscription.status` is no longer
   `ACTIVE`/`TRIALING`), which immediately locks `requireFeature()`-
   gated routes and makes `FeatureLock` components show their locked
   state again — automatically, with no extra code, because that's
   exactly what those checks already do today for a hypothetical
   non-Pro user. Renewing (status flips back to `ACTIVE` via another
   webhook) restores access on the very next request — there's no cache
   to invalidate.

### 4.6 Testing strategy used / recommended

Everything above was tested by directly exercising the real Prisma calls
and real HTTP endpoints against production data with disposable test rows
(a throwaway event, cleaned up after) — the same technique used
throughout this session for ticket/QR and venue-approval verification, see
§6. For the Stripe piece specifically, once real keys exist: use Stripe's
test-mode keys + the Stripe CLI's `stripe trigger checkout.session.completed`
(and the other event types above) to fire real, correctly-signed test
webhooks at a local server before ever touching live keys.

## 5. Backup practice established this session

No `pg_dump`/`psql`/`neonctl` available in this environment, and no Neon
API key configured — so there's no managed-snapshot path. Instead: a
Node script connects via `pg` using the root `.env`'s `DATABASE_URL`,
enumerates `pg_tables` in the `public` schema (excluding `_prisma%`), and
dumps every row of every table to one JSON file per table. Backups live in
`~/Documents/weyn-backups/<timestamp>/` — **outside the repo**, since they
contain real user emails/PII; never commit one. Take a fresh one before
any risky migration or direct-DB test session (this is now a standing
habit, same as the CSS brace-balance check used to be).

## 6. Testing approach for anything backend

There's no test-user login flow to script (no way to obtain a real Clerk
session token programmatically without a real password + a headless
browser flow through Clerk's hosted UI). The pattern that worked
repeatedly this session: create a real, disposable row directly via
Prisma (a throwaway event, owned by a real user id), exercise it through
the actual running local server (`npm run dev`, which points at the SAME
production Neon database — there is no separate local DB), verify via
direct queries or the real HTTP response, then delete every row created.
For anything that sends real email, check delivery via Resend's own API
(`GET /emails`) rather than trusting "no error was thrown."

Neon's pooled connections are occasionally slow to establish on a brand-
new script invocation (`ETIMEDOUT` on the first query, works on retry) —
this is normal Neon serverless-Postgres behavior, not a bug; just retry
once before assuming something's actually broken.

## 7. Known gaps, still real

- **Production Clerk is on test-mode keys** (§3) — the biggest one.
- **Ticket/QR retrieval** was completely broken before this session (a
  booking issued a real server-side ticket that the client could never
  display) — fixed, but only for web/PWA; there's no native app.
- **Native push (APNs)** is code-complete but unconfigured — needs an
  Apple Developer account. Web Push (VAPID) is live and is the channel
  that actually reaches anyone today.
- **Weyn's own paid ticketing (`ticketingType: "weyn"`) is rejected at
  event creation** (`server/app.js`, `POST /api/events`) — this predates
  this session and wasn't touched. This means the promo-code discount
  logic, once wired into a real checkout, has no live paid-Weyn-ticket
  event to apply to yet in production; it was tested via direct DB rows
  instead. Re-enabling paid Weyn ticketing is a separate, deliberate
  decision, not part of this work.
- **`dev.weynevents.com`** — blocked on the user creating a second
  Vercel project + a separate Neon dev database branch; nothing to build
  until those exist.
- **Invite-only hosting** — not yet started as of this doc's last update.
- A subtle, unresolved **visual rendering bug**: a faint white seam along
  one edge of the desktop magazine hero / mobile Featured card, at high
  device-pixel-ratio displays. Isolated to a genuine Chromium anti-
  aliasing artifact (`border-radius` + `overflow:hidden` clipping a
  scaled JPEG at high DPI) — reproduces in a bare-minimum `<div>` with
  nothing else on the page. Every standard CSS fix tried (mask-image,
  clip-path, transform/layer promotion, 1px overdraw, isolation) failed;
  only removing the rounded corner entirely fixes it, which is a real
  design change nobody's approved. Left as a known cosmetic issue.

## 8. If you're a fresh Claude picking this up

1. Read this file fully.
2. Check `TaskList`/whatever task tracker the session before you left —
   there's usually a live punch list more current than this doc's §7.
3. Take a fresh backup (§5) before any schema/data work.
4. For anything requiring visual verification, Playwright works directly
   against both localhost and the live production URL — the built-in
   preview tool and Chrome extension have not worked in this environment
   across multiple sessions; don't keep retrying them, just use
   Playwright.
