# Weyn — Handoff / Continuation Guide
*Last updated: 2026-07-08.*

Read this whole file before touching anything. Large parts of the previous
version of this doc (dated 2026-07-05) were stale — Google Sign-In was fully
replaced by Clerk, PayTabs got real (if unused) integration, the preview
tooling issue was root-caused, and a lot of new product surface shipped.
This version reflects the actual current state, including invite-only
hosting, `dev.weynevents.com`, a real accounts page, two production bugs
fixed, PostHog analytics, persistent tab navigation — **and the biggest
change: the live app is now admin-only, and `waitlist.weynevents.com` is
the new public face** (see §1 and §10).

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

**As of this pass, the live app is private** — gated to 4 admin emails via
a custom middleware (not Clerk's native allowlist — see §10 for why that
didn't work). Nobody else can get in, including anyone who signed up
before this change. The public-facing site is now
`waitlist.weynevents.com` (§10), a landing page with an email waitlist —
not the real app. This is a deliberate pre-launch state, not a bug: if
you're reading this because "the app doesn't let anyone in," that's
expected until launch.

## 2. Architecture at a glance

```
dhairya/
├── src/                      React 18 + TypeScript + Vite
│   ├── api.ts                  typed fetch client — every server route has a method here
│   ├── store.ts                 localStorage: saved, tickets (now {eventId,bookingId,accessToken}), theme, account
│   ├── webpush.ts                Web Push (VAPID) subscribe/unsubscribe client helper
│   ├── components/
│   │   ├── AuthGate.tsx           mandatory sign-up/sign-in wall — wraps every route but /onboarding
│   │   ├── AuthWall.tsx           the actual SignIn/SignUp UI, lazy-loaded from AuthGate — see §3
│   │   ├── TicketSheet.tsx        renders a real scannable QR from a booking's ticket code
│   │   ├── SubscriptionCard.tsx   Organizer Pro dashboard card (plan/renewal/features/billing history)
│   │   ├── UpgradeModal.tsx       Organizer Pro upgrade modal (CTA is inert — no billing wired yet)
│   │   ├── FeatureLock.tsx        Pro-gated UI wrapper — locked state + upgrade CTA
│   │   └── featureCatalog.ts      human-readable labels for the Pro feature flags
│   └── pages/
│       ├── Explore.tsx            discovery feed — Featured/Trending/Tonight/Weekend/category rails
│       ├── EventDetail.tsx        booking + "View ticket" QR retrieval + invite-only gating
│       ├── HostVenue.tsx           venue-hosting application wizard (8 steps incl. 3-tier Pro plan picker)
│       ├── Support.tsx            FAQ + contact form (/support)
│       ├── Account.tsx            real profile/email/password/connected-accounts/delete page (/account) — see §9
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

**Correction to earlier versions of this doc**: production does **not**
run Clerk's `pk_test_`/`sk_test_` keys — that was wrong, discovered while
debugging §10. The local `.env` file has the test key, which is stale/
out of sync with what's actually deployed; the real signal is what's
baked into the deployed JS bundle. Confirmed directly: `curl` the
deployed bundle and grep for `pk_live_`/`pk_test_` — production embeds
`pk_live_Y2xlcmsud2V5bmV2ZW50cy5jb20k` (decodes to `clerk.weynevents.com`),
the real production Clerk instance (`ins_3G4j3dNWSVbXIowYuXcdTYtwEAK`),
not the dev one. If you need to know which instance is actually live
again in the future, don't trust `.env` — check the deployed bundle.

**Bug fixed this pass — mandatory sign-up made the whole app slower for
everyone.** `AuthGate.tsx` originally imported Clerk's `SignIn`/`SignUp`
components eagerly. Since `AuthGate` wraps *every* route, that pulled a
substantial chunk of Clerk's UI internals into the main JS bundle for every
single page load — paid by every already-signed-in visitor, who never
renders that UI at all. Split the actual sign-in/sign-up markup out into
`AuthWall.tsx` and made `AuthGate` `lazy()`-import it only when rendering
the signed-out branch. Cut the main bundle from 554KB to 313KB (159KB →
93KB gzipped) — verified via `npm run build` output and a real Playwright
check of both the signed-in and signed-out paths. If you're chasing "the
site feels slow" again, check whether something new got imported eagerly
into a component that sits above the route switch (`App.tsx`, `AuthGate.tsx`,
`main.tsx`) before assuming it's a backend problem.

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
§12. For the Stripe piece specifically, once real keys exist: use Stripe's
test-mode keys + the Stripe CLI's `stripe trigger checkout.session.completed`
(and the other event types above) to fire real, correctly-signed test
webhooks at a local server before ever touching live keys.

## 5. Invite-only hosting

An organizer can mark any event invite-only — completely free, not an
Organizer Pro feature. Migration `20260707200000_invite_only_events` adds
`Event.inviteOnly` (bool) and `Event.inviteCode` (unique, nullable —
generated the moment invite-only is turned on).

- **Toggle/rotate**: `PATCH /api/events/:id/invite-only` (owner-only)
  flips the flag and generates an 8-char code on first enable;
  `POST /api/events/:id/invite-only/regenerate` rotates the code without
  touching the flag — separate endpoints on purpose, so turning it off and
  back on doesn't silently invalidate a link someone's already holding.
- **Never appears in Discovery**: `GET /api/events`'s existing
  cancelled/approved/past filter gained one more clause, `!e.inviteOnly`.
  Still reachable by direct link (`GET /api/events/:id`) — the invite
  recipient needs to see what they're being invited to — but that response
  strips `inviteCode` for everyone except the owner, and sets
  `Cache-Control: private, no-store` instead of the normal event-detail
  caching, so a shared link never gets cached with the code baked in.
- **Booking gate**: both `POST /api/events/:id/book` and `.../checkout`
  403 with `{code: "INVITE_REQUIRED"}` unless the request body's
  `inviteCode` matches. The frontend reads `?invite=CODE` off the URL
  (`EventDetail.tsx`) and threads it through automatically — a recipient
  who opens the shared link never has to type anything.
- **Organizer UI**: `You.tsx` → Organizer dashboard → "Invite-only" button
  per event opens `InviteOnlySheet` (same pattern as the existing
  `MarketingSheet`) — toggle, copyable link, regenerate.

Verified end-to-end against a real disposable production event before
shipping: excluded from discovery ✓, code absent from the public detail
response ✓, booking with no code rejected ✓, wrong code rejected ✓,
correct code succeeds and issues a real ticket ✓.

## 6. `dev.weynevents.com`

A second, fully isolated environment for testing anything without
touching real user data — separate Neon database, separate Clerk
instance (the dev instance from §3 that was already configured), separate
Vercel project, gated behind HTTP Basic Auth so it isn't just sitting open
on the internet.

- **Database**: Neon project `weyn-dev` (id `sweet-base-90708856`, same
  `eu-central-1` region as prod). All 19 migrations applied via `prisma
  migrate deploy` against its connection string — empty schema, no prod
  data copied over (deliberately: this is for testing flows, not staging
  real data).
- **Vercel**: new project `weyn-dev` (not a preview deployment of the
  `dhairya` project — a fully separate project, so its env vars, Blob
  store, and domain can't accidentally collide with production). Tracks
  its own `dev` git branch. Env vars: dev Clerk keys, the dev DATABASE_URL
  above, a dedicated public Blob store (`weyn-dev-uploads`), its own
  `SESSION_SECRET`. Shares the same Resend/Groq/Google/VAPID/Sentry keys
  as prod (those are third-party accounts, safe to reuse) but **not**
  PayTabs — prod itself doesn't have live PayTabs keys wired (see §13),
  so there was nothing to carry over and no real-payment risk either way.
- **Access control**: `server/app.js` gates the *entire* app behind HTTP
  Basic Auth whenever `DEV_BASIC_AUTH_USER`/`DEV_BASIC_AUTH_PASS` are set
  — checked as the very first middleware, before Helmet/CORS/routes. Only
  set on the `weyn-dev` Vercel project; production never sets these, so
  the check is a complete no-op there (verified: prod's `/api/health`
  returns 200 with no auth prompt, `weyn-dev`'s returns 401 without
  credentials, 401 with wrong ones, 200 with the right ones). Credentials
  live in the `weyn-dev` Vercel project's env vars — ask whoever has
  Vercel dashboard access if you need them and don't have them handed to
  you separately.
- **DNS — the one manual step**: `weynevents.com`'s DNS is on Cloudflare
  (nameservers `molly`/`newt.ns.cloudflare.com`), and nothing in this
  environment had write access to that zone (`wrangler`'s OAuth token is
  `zone:read` only). Vercel's own domain-add flow needs one A record added
  by hand in the Cloudflare dashboard: `dev` → `76.76.21.21`, DNS-only (grey
  cloud, not proxied — same as the existing root-domain record). Until
  that record exists, the working URL is `https://weyn-dev.vercel.app`
  (same app, same basic-auth gate, same dev database) — fully usable today,
  the custom domain is just a nicer name for it.

## 7. Two production bugs fixed this pass

**"Events I upload don't show up on other devices."** `GET /api/events`,
`GET /api/events/:id`, `GET /api/venues`, and `GET /api/venues/:id` were
all serving `Cache-Control: public, max-age=30` — cheap to justify
(queries run in ~130ms warm, caching saved little) but meant a newly
published event or venue could read as "missing" on another device or
another edge POP for up to 30 seconds after publish. Switched all four to
`no-store`. If discovery-feed traffic ever gets heavy enough that this
matters for load, the right fix is a short `stale-while-revalidate`
window, not going back to a blind `max-age`.

**Site suddenly felt slow** — see §3's note on the `AuthGate`/`AuthWall`
split. Same root cause investigation, listed here too since it was raised
as a separate complaint at the time and is easy to miss if you only read
§3 looking for auth-specific content.

## 8. Accounts page (`/account`)

Settings (Profile → Settings) previously only showed a read-only
name/email/avatar row (`AccountWidget.tsx`) with a sign-out button — no
way to actually change anything about your own account. `src/pages/Account.tsx`
(lazy-loaded route, linked from Settings as "Manage account") now covers:

- Name, username, avatar (direct `user.update()` / `user.setProfileImage()`
  calls against Clerk — no new backend route needed, Clerk owns this data).
- Email change with real code verification (`createEmailAddress` →
  `prepareVerification({strategy:"email_code"})` → `attemptVerification` →
  set as primary → delete the old address).
- Password change (`user.updatePassword()`, `signOutOfOtherSessions: true`
  so a password change actually kicks out anyone else with a live session).
- Connect/disconnect Google (`user.createExternalAccount({strategy:
  "oauth_google"})` / `externalAccount.destroy()`).
- Delete account — moved here from Settings verbatim, same
  `api.deleteAccount()` → cancels hosted events server-side → Clerk
  `signOut()` flow as before.

**Deliberately not** Clerk's prebuilt `<UserProfile/>` component, for two
reasons: it bundles its own account-deletion flow that has no way to hook
in the server-side hosted-events cleanup above (so using it would mean
either two different delete flows or losing the cleanup), and — same
lesson as §3 — it's another heavy Clerk UI import that would need
lazy-loading discipline anyway, at which point hand-building the handful
of fields this app actually needs was less code, not more.

Not built: session/device management, 2FA setup (Clerk's `<UserProfile/>`
gets these for free; this hand-built page doesn't have them). Worth
revisiting if either becomes an actual user request rather than "Clerk
would give it to us for free."

## 9. Persistent tab navigation + PostHog analytics

**Bottom-tab pages now stay mounted.** Explore/Reservations/HostHub/You
used to fully unmount and remount on every tab switch (a plain
`react-router-dom` `<Outlet/>` does this by default) — losing scroll
position and re-fetching data every single time you tapped back to a tab
you'd already loaded. `App.tsx` now renders these 4 pages itself (not via
`<Outlet/>`): each mounts once on first visit, then just toggles
`display:none` on further switches. Verified with a real browser test —
tagged a DOM node inside Explore, switched through all 4 tabs, confirmed
the exact same node (never recreated) was still there. Drill-down subpages
reached from within a tab (`/saved`, `/host/events`, `/host/venue`,
`/admin`) are **not** part of this — those still mount fresh via a normal
`<Outlet/>`, which is correct for a page you navigate into and back out of
rather than switch to repeatedly. See `main.tsx`'s route tree comment and
`App.tsx`'s `MAIN_TABS` for the mechanism.

**PostHog** (`src/posthog.ts` client, `server/monitoring.js` server —
already existed but was never configured) is now live, same project token
for both. The client import is **dynamic**, not static — `posthog-js` is a
meaningful chunk of code, and main.tsx is the one place a static import
can't be lazy-loaded away; a static import here would have put it right
back in the entry bundle, the exact mistake just fixed for Clerk's
SignIn/SignUp (§3). Confirmed via build output: it lands in its own
`module-*.js` chunk, main bundle stays at 314KB. `identifyPostHog()` /
`resetPostHog()` are wired into `ClerkAuthBridge` so anonymous activity
links to the real user the moment they sign in.

**`.profile-tabs` (You.tsx's Overview/Organizer/Tickets/Saved/Lists/
Settings row) now wraps instead of horizontally scrolling.** This is
primary navigation, not a filter row like Explore's category chips — Settings
or Lists sitting permanently off-screen behind a swipe gesture was a real
usability problem the user flagged directly ("really impractical").

## 10. The live app is now admin-only; `waitlist.weynevents.com` is the new public face

Per explicit direction: take the real app private ahead of a proper
launch, put a waitlist landing page in its place. Two independent pieces:

**1. Access gate — a custom middleware, NOT Clerk's built-in allowlist.**
The first attempt at this used Clerk's native `auth_access_control`
allowlist feature, patched onto the "dev" Clerk instance. That had zero
effect on the live site: production actually runs on the **separate live
instance** (`clerk.weynevents.com`, `ins_3G4j3dNWSVbXIowYuXcdTYtwEAK` —
see the correction in §3), and that instance's Clerk plan doesn't support
the allowlist feature at all — enabling it 403s with
`unsupported_subscription_plan_features`. **The app was fully open to
public sign-up for some amount of this session before this was caught
and fixed** — if anyone signed up during that window, their account
still exists (Clerk user, not deleted) but can no longer sign in.

The actual, working gate: `server/app.js`, registered right after
`app.use(attachUser)`. Reads `ADMIN_ALLOWLIST_EMAILS` (comma-separated,
set only on the `dhairya` Vercel project's Production env and as a
`wrangler secret` on the Cloudflare Worker — **not** in local `.env`, so
local dev stays open) and rejects any request — including fully
anonymous ones — whose resolved email isn't on the list, with one
exemption: requests to the `waitlist.weynevents.com` hostname always pass
through. Four emails are allowed: `dhairyarsaluja@gmail.com`,
`rohitssaluja@gmail.com`, `krishivsaluja@gmail.com`,
`bhattacharyamonami@gmail.com`. Verified directly against production:
anonymous `GET /api/events` → `403 PRIVATE_BETA`; the same request with
`Host: waitlist.weynevents.com` → `200` (real event data).

**A real, separate gotcha surfaced while testing this**: Clerk's
allowlist (were it available) only matches by exact identifier —
usernames can't be allowlisted at all (`identifier must be either a
valid email address, a valid phone number... or a valid web3 wallet`).
Not relevant to the custom gate above (which checks the resolved
account's actual email, not whatever string was typed at sign-in), but
worth knowing if Clerk's native allowlist ever gets revisited (e.g. after
a plan upgrade) — a user signing in by username instead of email would
be rejected even if their email is on the list.

To reverse this later (real public launch): remove `ADMIN_ALLOWLIST_EMAILS`
from both the Vercel project and the Worker secret, then redeploy both.
Nothing else about the app depends on it being set.

**2. `waitlist.weynevents.com` — a standalone landing page, not a route
inside the real app.** `main.tsx` checks `window.location.hostname` before
anything else mounts — Clerk, the router, the tab shell, none of it loads
for a waitlist visitor, only `src/pages/WaitlistLanding.tsx` (its own
~1KB lazy chunk). Email capture posts to `POST /api/waitlist`, backed by
a new `LandingWaitlistSignup` table — deliberately separate from the
existing per-event `WaitlistEntry` model (that one is sold-out-ticket
waitlists tied to a real `Event`; this one is generic marketing capture
with no relation to anything else). Local testing: `?waitlist=1` query
param triggers the same branch as the real hostname (no easy way to hit
an actual subdomain against `npm run dev`).

Domain is added to the `dhairya` Vercel project (same project as the main
app — this isn't a separate deployment) but **needs one manual DNS
record**, same limitation as `dev.weynevents.com` in §6 (no zone-write
access from this environment): `A waitlist.weynevents.com 76.76.21.21`,
DNS-only/grey-cloud on Cloudflare. Until that's added, nothing serves at
that hostname yet — the code is deployed and correct, it's purely the DNS
record blocking it from being reachable.

Signups aren't emailed anywhere automatically yet — they just accumulate
in `LandingWaitlistSignup`. Query them directly via Prisma
(`prisma.landingWaitlistSignup.findMany()`) until there's a real launch
flow to notify them through.

## 11. Full QA sweep (security, functional, visual, performance)

Requested explicitly given how much shipped this session. A dedicated
subagent did a manual security read of every route in `server/app.js`
plus `auth.js`/`db.js`/`payments.js`/`moderation.js`/`image-utils.js`;
functional/visual/race-condition testing below was done directly against
real signed-in browser sessions (a disposable Clerk test user, cleaned up
after) on local dev and, for the access-gate fix, production itself.

### Fixed immediately (all deployed)

1. **CRITICAL — the admin-only gate wasn't actually gating production.**
   Covered in full in §10. Found *during this sweep*, not before —
   worth restating here because it's the single most important thing
   this pass turned up: a security feature can look completely correct
   in isolation (the Clerk config really was patched, really did have
   the allowlist enabled) and still do nothing, if it's pointed at the
   wrong instance. The lesson: when a fix depends on "which environment
   is actually live," verify against the deployed artifact itself
   (the JS bundle, in this case), not against local config files or
   assumptions from earlier in the same session.
2. **CRITICAL — invite-only event codes leaked via search, following-feed,
   and collections.** Full detail in §5's cross-reference and the git log
   (`bc63abd`). The original invite-only fix only touched `GET /api/events`
   and `GET /api/events/:id`; `shape()`'s three other callers didn't
   filter/strip at all. Verified exploitable end-to-end (create a
   collection, add the invite-only event's id, read the code back) before
   fixing, and confirmed closed after.
3. **HIGH — a real, intermittent app bug**: the Profile tab (Overview,
   Organizer, Venues, Settings — including the Manage Account link) could
   get permanently stuck on "Couldn't reach the server" right after
   sign-in. Root cause and fix in `src/store.ts`'s `getAuthToken()` — see
   git log (`33b3e14`) for the full writeup. Reproduced intermittently
   with real network traces before the fix (a burst of 401s on `/api/me`,
   `/api/dashboard/events`, `/api/dashboard/summary`, `/api/venues/mine`);
   ran clean 5/5 after.
4. **MEDIUM — webhook handler crash**: `verifyIpnSignature`'s HMAC call
   sat outside its own try/catch and threw on a non-JSON request body,
   which would have crashed that request once PayTabs keys are ever set.
   Fixed (`server/payments.js`).
5. **MEDIUM — CSV injection** in the attendees export: attendee
   name/email (unvalidated checkout free text) could start with
   `=`/`+`/`-`/`@` and execute as a formula when the organizer opened the
   CSV in Excel/Sheets. Fixed with a leading-apostrophe guard
   (`server/app.js`).
6. **LOW-MEDIUM, bundled together**: non-constant-time invite-code
   comparison (now `crypto.timingSafeEqual`), missing rate limiters on
   `POST /api/promo-codes/validate` (human-guessable-code brute-force
   oracle) and `POST /api/events/:id/team/invite` (unbounded real emails
   per authenticated account), and unescaped event
   title/subject/message in booking-confirmation, team-invite, and
   bulk-notify emails (XSS-adjacent HTML injection into a trusted,
   branded email — not exploitable on the site itself, since the React
   frontend never uses `dangerouslySetInnerHTML`). All fixed in one pass,
   see git log (`9219539`).

### Confirmed safe (audited, not just assumed)

No SQL injection anywhere (100% parameterized Prisma, including every
raw `$queryRaw` call) · the `DEV_BASIC_AUTH` gate's timing-safe comparison
has no bypass path · identity is derived exclusively from Clerk's verified
session, never from client-supplied data · CORS refuses to boot without an
explicit origin allowlist · CSP has no `unsafe-inline`/`unsafe-eval` in
`script-src` · booking/ticket capacity claims and check-in are atomic
(no overselling/double-check-in races) · booking access tokens are
`crypto.randomBytes`-generated · team invites are single-use and
email-matched · every file upload sniffs real magic bytes rather than
trusting `Content-Type` · `/api/waitlist` already had its own rate limiter
and doesn't leak whether an email already exists.

### Known, not fixed this pass (flagged, not silently left)

- **Rate limiting is real per-process but not real in production.**
  Every limiter in `server/app.js` uses `express-rate-limit`'s default
  in-memory store, but production runs as Vercel serverless functions —
  each concurrent function instance has its own independent counter, so
  the effective ceiling under real concurrent load is
  `configured_max × concurrent_instances`, not the number in the code.
  This is a systemic gap across every limiter, not a single-route bug.
  Fix requires a shared store (Redis/Upstash) reachable from every
  instance — real infra work, not a quick patch, and this app has zero
  real signed-up users right now so it's low urgency until that changes.
- **`requireFeature()` on a few MANAGER-reachable Pro routes** (featured,
  promo codes, CSV export, notify, recurring) checks the *acting* user's
  subscription rather than the *event owner's* — inconsistent with
  `GET /api/events/:id/analytics`, which explicitly checks the owner's
  plan. Not exploitable today (everyone auto-gets Pro for free per §4),
  fails closed (a MANAGER without their own grant gets wrongly 403'd, not
  wrongly admitted) — worth aligning before real billing differentiates
  plans.
- **SSRF guard in `instagram-import.js`** blocklists literal
  hostnames/IPs but doesn't resolve DNS first, so a theoretical
  DNS-rebinding attack could bypass it. Narrow real exposure (the scraped
  URL comes from Instagram's own page content, not directly from
  attacker input) — informational, not urgent.
- **Icon-and-label buttons/links throughout the app compute a slightly
  wrong accessible name** — e.g. the bottom-nav "Host" link's accessible
  name is `" Host"` (leading space), not `"Host"`, because the decorative
  `<i className="icon-*">` before the label isn't marked
  `aria-hidden="true"`, and browsers' accessible-name computation still
  counts its (empty) presence as a separate node needing a separator
  space. Cosmetically invisible (click targets, layout, and visual
  rendering are all unaffected), but a real screen-reader/automated-a11y-
  testing correctness issue, and it's the same pattern almost everywhere
  in this codebase (`<i className="icon-x"/><span>Label</span>`) — a
  fix would be mechanical (add `aria-hidden="true"` to every purely
  decorative icon `<i>`) but touches a lot of files, so it wasn't done
  as a drive-by during this sweep.

### Visual / functional / performance — no other issues found

Screenshots at mobile (390×844) and desktop (1440×900), both light and
dark mode, of the auth wall and the waitlist landing page: no layout,
contrast, or theming bugs. Main JS bundle: 314KB / 93KB gzipped (down
from 554KB pre-session, per §3's fix). Production TTFB from this
environment: ~570-600ms warm — dominated by network/geographic distance
from this session's location to Vercel's edge, not app code; worth
checking Vercel's function region is actually close to Oman if real
users start reporting slowness once the app is public.

No `pg_dump`/`psql`/`neonctl` available in this environment, and no Neon
API key configured — so there's no managed-snapshot path. Instead: a
Node script connects via `pg` using the root `.env`'s `DATABASE_URL`,
enumerates `pg_tables` in the `public` schema (excluding `_prisma%`), and
dumps every row of every table to one JSON file per table. Backups live in
`~/Documents/weyn-backups/<timestamp>/` — **outside the repo**, since they
contain real user emails/PII; never commit one. Take a fresh one before
any risky migration or direct-DB test session (this is now a standing
habit, same as the CSS brace-balance check used to be).

## 13. Testing approach for anything backend

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

**Signing up through the real UI in headless Playwright doesn't work** —
confirmed while testing §8: Clerk's Cloudflare Turnstile bot-check 401s
against `challenges.cloudflare.com` in headless Chromium and the sign-up
button spins forever. This is a well-known headless-browser limitation
(Clerk's own docs point at installing `@clerk/testing`'s
`setupClerkTestingToken()` specifically to bypass it), not an app bug —
real users in a real browser are unaffected. `+clerk_test@` email
addresses (which accept the fixed code `424242` with no real email) do
still work for the *email verification step itself*; it's Turnstile on
the initial submit that headless browsers can't clear. If you need a real
signed-in session for E2E testing without adding that dependency, the
established fallback in this codebase is §10's pattern above: create rows
directly via Prisma rather than going through the UI at all.

## 14. Known gaps, still real

- **`waitlist.weynevents.com` DNS record not added yet** (§10) — the code
  is deployed, the domain is added to the Vercel project, but the actual
  `A waitlist.weynevents.com 76.76.21.21` record needs to be added by hand
  on Cloudflare. Nothing serves at that hostname until then.
- **Production Clerk is on test-mode keys** (§3) — the biggest one.
- **Organizer dashboard** — see §14 for the planned rebuild. Today's
  Organizer tab is a flat per-event list with no cross-event view; the
  Pro backend (§4) has no UI hooks into it yet either.
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
- A subtle, unresolved **visual rendering bug**: a faint white seam along
  one edge of the desktop magazine hero / mobile Featured card, at high
  device-pixel-ratio displays. Isolated to a genuine Chromium anti-
  aliasing artifact (`border-radius` + `overflow:hidden` clipping a
  scaled JPEG at high DPI) — reproduces in a bare-minimum `<div>` with
  nothing else on the page. Every standard CSS fix tried (mask-image,
  clip-path, transform/layer promotion, 1px overdraw, isolation) failed;
  only removing the rounded corner entirely fixes it, which is a real
  design change nobody's approved. Left as a known cosmetic issue.

## 15. Organizer dashboard — planned rebuild (not started)

Today's entire "organizer dashboard" is `OrganizerSection` inside
`You.tsx`'s Organizer tab: one stat grid (lifetime totals, no trend), a
flat list of event cards, and a row of up to 9 buttons per card that each
open a separate modal sheet (`EditSheet`, `AttendeesSheet`,
`MarketingSheet`, `AnalyticsSheet`, `TeamSheet`, `CheckInSheet`,
`InviteOnlySheet`). It works, but it's a tab, not a product surface — and
per explicit direction, this is meant to become one of the app's key
features, not stay a corner of the profile screen.

The good news: §4 already built most of the *backend* this needs
(promo codes, waitlists, bulk notify, recurring events, CSV export,
featured placement, advanced analytics) — none of it has UI hooks yet
(flagged in §4.4). A large fraction of "the dashboard" is wiring work
against endpoints that already exist and are already tested, not new
product design. What follows is organized around that distinction.

### Proposed structure

Promote Organizer from a `You.tsx` tab to its own top-level section
(`/organizer`, real routes not modal sheets, deep-linkable — e.g.
`/organizer/events/:id/analytics` instead of a sheet with no URL of its
own) with six areas:

**1. Overview (home)** — *mostly new*
Replace the static lifetime stat grid with an actual dashboard: a
sales/revenue trend chart (needs a time-series query — today's stats are
all-time totals, no day-by-day breakdown exists yet), next-3-upcoming-
events at a glance, and an "needs attention" list surfacing things that
currently require hunting through the event list to notice: events stuck
in `MANUAL_REVIEW`, pending team invites, an upcoming event with zero
sales, a waitlist with no invites sent.

**2. Events** — *mostly wiring*
Keep the existing card list but add filtering (upcoming/past/cancelled)
and a calendar view (new, but pure frontend — the data already exists).
Replace the 9-button row with a proper per-event workspace: a real tabbed
page (Overview/Analytics, Attendees, Promo codes, Waitlist, Marketing,
Team, Settings) instead of one-off modals — this is where promo codes,
waitlists, notify, recurring, and featured-toggle actually get a UI for
the first time. Bulk actions (bulk cancel/duplicate) are new but small.

**3. Attendees / CRM (cross-event)** — *new, needs a new endpoint*
Every attendee across every event the organizer owns, deduped by
user/email, with total spend and events attended — lets an organizer see
their repeat customers instead of only per-event attendee lists. Needs a
new aggregate query (`GET /api/organizer/attendees`); nothing like this
exists today even at the data layer.

**4. Finance (cross-event)** — *new, and partly blocked*
Revenue by event/by month, Weyn fees paid, refunds issued — the
aggregate numbers mostly already exist per-event via `db.eventAnalytics()`
and just need a cross-event rollup endpoint. Real payout tracking
(when/how an organizer actually gets paid out) is blocked on §4.5 — there
is no payment processor wired that could a produce a real payout event to
track yet, so this section should ship as a reporting view first and stay
honest that "payout status" isn't real until PayTabs (or Stripe, if that
ever extends past Pro billing to ticket payments) is actually live.

**5. Marketing (cross-event)** — *mostly wiring, one new piece*
Surface the existing per-event AI marketing-copy generator and promo-code
manager across all events instead of one at a time. One genuinely new,
small addition: a shareable QR code / printable poster for an organizer's
public profile page (`OrganizerProfile.tsx` already exists) for offline
promotion — not built anywhere today. Referral/UTM tracking
(`trafficSources` from §4.3) stays explicitly out of scope until real
instrumentation exists.

**6. Settings** — *new*
Organizer public profile currently has no dedicated settings — bio,
links, and branding shown on `OrganizerProfile.tsx` would need actual
owner-editable fields (new, small schema addition). Relocate
`SubscriptionCard` here from `You.tsx`. Default event settings (default
refund policy/capacity/category, so creating a 10th event doesn't mean
retyping the same values) is a pure quality-of-life addition with no
backend complexity.

### Suggested phasing

1. **Wire what's already built**: promo codes, waitlist, notify,
   recurring, featured, CSV export UI into a real per-event workspace.
   This alone converts a large amount of already-shipped, already-tested
   backend from "exists but nobody can reach it" into a real feature —
   almost no new backend work, `FeatureLock.tsx` already exists to show
   the Pro-gated state around each one.
2. **Cross-event views**: Attendees/CRM and Finance rollups — new
   aggregate endpoints, moderate backend work, big organizer-facing value
   (this is the part that actually makes it feel like "a dashboard"
   rather than a list of events).
3. **Settings, calendar view, poster/QR generator, default event
   settings** — smaller, independent, can slot in whenever.

None of this is built yet — this is the plan, not a changelog entry. If
you're picking this up, start with phase 1: it's the highest ratio of
organizer-visible value to actual new code, since the hard part (the
backend) already happened in §4.

## 16. If you're a fresh Claude picking this up

1. Read this file fully.
2. Check `TaskList`/whatever task tracker the session before you left —
   there's usually a live punch list more current than this doc's §14.
3. Take a fresh backup (§12) before any schema/data work.
4. For anything requiring visual verification, Playwright works directly
   against both localhost and the live production URL — the built-in
   preview tool and Chrome extension have not worked in this environment
   across multiple sessions; don't keep retrying them, just use
   Playwright.
