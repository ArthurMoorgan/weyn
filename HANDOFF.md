# Weyn — Handoff / Continuation Guide
*Last updated: 2026-07-12 (see §19-§25 for everything since 2026-07-08 — a
multi-pass redesign saga that landed on coral/Plus Jakarta Sans, VenueOS
promoted to its own dashboard with a node-graph workflow builder, agentic AI
Phase 1 ("AI Studio"), several critical bug fixes, a landing-page rebuild,
in-progress uncommitted work on a marketing "social kit," and an Events-side
workflow builder that's now feature-complete-but-uncommitted (§24.2) with its
sibling Venue-side UX upgrade still unstarted (§25). §1-§18 below are
unchanged from the 2026-07-08 pass and still accurate except where a §19-§25
note says otherwise — read those sections' cross-references before trusting
a color/palette/IA claim in the older text, since there were several reverts
in between.*

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
  PayTabs — prod itself doesn't have live PayTabs keys wired (see §16),
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

**3. `AuthGate.tsx` now shows this same page on `weynevents.com` itself,
to anyone who isn't an admin — not just on the separate waitlist
subdomain.** Originally, a non-admin who signed up on the real domain
still saw the normal sign-up form, then landed on a completely broken
all-401s app shell once every API call hit the server-side gate above.
`AuthGate` now makes one `GET /api/me` check after sign-in and uses its
status as the single source of truth: signed-out or non-admin both
render `WaitlistLanding` (imported directly, not via the hostname
branch — same component, two different entry points), with a discreet
"Team sign in" link/back-button pair so an admin who hasn't
authenticated yet can still reach the real sign-in form. See §12 for
what that page actually looks like now.

## 11. Critical: Clerk had "require an organization" turned on — likely blocking real signups silently

Found by accident while testing §10's gate, not something anyone was
looking for: Clerk's `organization_settings.force_organization_selection`
was `true` on **both** the dev and the live production instance. Weyn
has no Organizations feature anywhere in this codebase — it's a
single-tenant consumer app — so this was dead config, almost certainly
left over from Clerk's default project scaffolding and never noticed.

**What it actually did**: after a successful sign-in, Clerk considers
the session "pending" (not fully active) until the user completes an
org-selection/creation step. Since neither `<SignIn/>`/`<SignUp/>` nor
anything else in this app renders Clerk's organization UI, a user in
that state got redirected to Clerk's internal `#/tasks/choose-organization`
route — which our router doesn't recognize, doesn't render anything for,
and which the user has no way to get past. Their session was real and
"signed in" by some checks (`isSignedIn` in `@clerk/react`) but every
authenticated API call 401'd (`toAuth().userId` is `null` for a pending
session), which is indistinguishable from the account simply not being
allowlisted — this is exactly what made it hard to notice: it looks like
"the private-beta gate is working," not "sign-in is broken."

**Impact**: potentially every brand-new sign-up on production, ever,
depending on account/session state — not something introduced this
session, this predates all of today's work. Given the private-beta gate
(§10) already blocks all real traffic right now, the practical blast
radius today is limited to the 4 admin accounts, but this would have
been a real, silent blocker to public launch if it had shipped as-is.

**Fix**: `organization_settings.enabled: false` on both Clerk instances
(via `clerk config patch`), which also flips `force_organization_selection`
to `false`. Verified via a real signed-in session before (stuck on the
waitlist page with a 401 from `/api/me`, URL parked at
`#/tasks/choose-organization`) and after (lands on the real app
immediately, `/api/me` returns 200) the fix.

## 12. Landing page rebuild

`WaitlistLanding.tsx` (§10) went from a bare headline + email form to an
actual landing page, built from three React Bits components — adapted,
not pasted in as-is:

- **Ferrofluid** (`src/components/landing/Ferrofluid.tsx`) — a WebGL
  magnetic-fluid shader background (`ogl`), retuned to Weyn's own
  indigo/blue brand colors instead of the demo palette, masked with a
  radial gradient so it reads as an ambient glow behind the hero rather
  than a hard-edged rectangle, and **lazy-loaded** (`React.lazy`) — ogl +
  shader compilation is the single heaviest piece of this page, and the
  headline/form need to work even on a browser with no WebGL. Cleanup on
  unmount calls `program.remove()`/`geometry.remove()` (the actual ogl
  API — `Renderer` itself has no equivalent method, verified against ogl's
  shipped `.d.ts` files) plus `WEBGL_lose_context`, since this is a
  marketing page real users may navigate away from repeatedly.
- **SplitText** (`gsap` + `gsap/SplitText`, free as of GSAP 3.13 — no
  paywall to work around) — word-by-word reveal animation for the
  headline.
- **RotatingText** (`motion/react`) — cycles "discover events / host
  events / reserve a table" in the subheading instead of three static
  headlines.

All three, plus `@base-ui/react` (used for the email form's `Field`
primitives — proper label/input association instead of bare `<input>`s)
live entirely inside `WaitlistLanding`'s own lazy chunk. Verified via
`npm run build` output: the main app bundle is untouched (~315KB,
same as after §3's fix); the new deps only ship to whoever actually
lands on the waitlist page.

Also added a real "first look" section with three actual product
screenshots (Discover feed, an event detail page, desktop with the
magazine hero) — captured live against a disposable Clerk test account
and disposable demo events (real Unsplash photos, verified by eye before
use, cleaned up after), optimized PNG→WebP (`cwebp -q 82`, ~15-20% of
original size, e.g. 490KB→56KB) — plus a three-pillar
Discover/Host/Reserve feature strip reusing the app's existing icon font.

## 13. Full QA sweep (security, functional, visual, performance)

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

## 14. Backup practice established this session

No `pg_dump`/`psql`/`neonctl` available in this environment, and no Neon
API key configured — so there's no managed-snapshot path. Instead: a
Node script connects via `pg` using the root `.env`'s `DATABASE_URL`,
enumerates `pg_tables` in the `public` schema (excluding `_prisma%`), and
dumps every row of every table to one JSON file per table. Backups live in
`~/Documents/weyn-backups/<timestamp>/` — **outside the repo**, since they
contain real user emails/PII; never commit one. Take a fresh one before
any risky migration or direct-DB test session (this is now a standing
habit, same as the CSS brace-balance check used to be).

## 15. Testing approach for anything backend

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

## 16. Known gaps, still real

- **`waitlist.weynevents.com` DNS record not added yet** (§10) — the code
  is deployed, the domain is added to the Vercel project, but the actual
  `A waitlist.weynevents.com 76.76.21.21` record needs to be added by hand
  on Cloudflare. Nothing serves at that hostname until then.
- **Organizer dashboard** — see §17 for the planned rebuild. Today's
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

## 17. Organizer dashboard — planned rebuild (not started)

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

## 18. If you're a fresh Claude picking this up

1. Read this file fully.
2. Check `TaskList`/whatever task tracker the session before you left —
   there's usually a live punch list more current than this doc's §16.
3. Take a fresh backup (§14) before any schema/data work.
4. For anything requiring visual verification, Playwright works directly
   against both localhost and the live production URL — the built-in
   preview tool and Chrome extension have not worked in this environment
   across multiple sessions; don't keep retrying them, just use
   Playwright.

---

# Everything since 2026-07-08 (73 commits, plus uncommitted work in progress)

This section was written 2026-07-12 by a fresh session reconstructing 73
commits (`git log --oneline --since="2026-07-08"`) plus the working tree's
current uncommitted diff. §1-§18 above are the 2026-07-08 baseline and are
still mostly accurate; where this section says a claim above is now wrong
(mainly the color-palette description implicit in file paths/component names
from that era), trust this section.

A separate, narrower handoff file, `CLAUDE_LIMIT_HANDOFF.md`, was created
2026-07-12 specifically to survive a Claude session-limit cutoff mid-way
through the design-reference implementation (§21 below). It's a
contingency doc, not a second source of truth — this section folds in
everything from it that's still relevant. It's safe to leave in the repo
(harmless if stale) or delete once §21 is fully wrapped up; don't delete the
open checklist items in it without carrying them forward here first.

## 19. The redesign saga — what actually shipped vs. what got reverted

Between 2026-07-08 and 2026-07-12 there were, by commit-subject count, at
least five distinct full-app visual redesign passes, several of which were
reverted same-day (sometimes reverted, then that revert itself reverted).
**Do not replay this whole history in code or in your head — here is only
where it landed, plus the one or two lessons worth keeping.**

**Sequence, compressed:**
1. Indigo/violet brand color (pre-existing, per §1-§18) → replaced with
   "warm terracotta/sand" (`d630e8f`).
2. Navigation IA reworked (Tickets tab replaces Host, Profile slimmed —
   `cd79c6e`), then an "Airbnb-inspired system" pass introduced a "real
   coral brand color" (`1be1741`), then a second redesign pass (flat tab
   bar, Discover events/venues toggle, 3D buttons — `8206e57`).
3. A full palette swing away from coral into an amber/khanjar-terracotta
   "Muscat-grounded" system (night/limestone/amber — `67947b0`), tuned
   twice more (`7320774` desaturate amber/drop serif hero, `f0e0b79` reduce
   amber overuse), then **explicitly dropped entirely** back to
   terracotta-as-primary (`7eb2a4f`, "Drop amber/yellow entirely — khanjar
   terracotta as primary").
4. Separately, the whole-app "colour and life" pass (bottom bar, chips,
   cards, More hub — `95a68ce`) went through four
   revert/revert-the-revert/revert-that-too cycles in immediate succession
   (`04c0d28` → `bbe79dd` → `11a659c` → `9b60421` → `086dd4a`) before a
   final pass (`01393e4`, "Analyze competitor app, revert multi-hue colour,
   redesign bottom bar") settled it back down to a restrained palette.
5. **Where it actually landed**: a design-reference package the user
   supplied 2026-07-12 (`design_handoff_ticketing_app` — see §21)
   specified, independently of all the above churn, almost exactly the
   same coral the "Airbnb-inspired" pass had tried back in step 2:
   `#E1483D` light / `#FF6B5B` dark. The user's own explicit direction at
   that point (recorded in `CLAUDE_LIMIT_HANDOFF.md`) was "move away from
   the amber/khanjar-terracotta palette (tried and rejected across several
   iterations earlier this session) back to the original Airbnb-style
   coral." `b9584f8` ("Implement design-handoff spec: coral system + Plus
   Jakarta Sans") is the commit that actually shipped this, and it is
   **current production state** — verified directly in
   `src/index.css` (both `:root` and `:root[data-theme="light"]` blocks),
   not just inferred from the commit message.

**Final, current visual system (verified against `src/index.css` as of
this pass):**
- Font: **Plus Jakarta Sans** everywhere (`--f-display`, all `--t-*` type
  tokens), loaded via Google Fonts.
- Light theme: `--primary: #E1483D` (coral), `--primary-hover: #EA5B50`,
  `--primary-pressed: #C93A30`, `--on-primary: #FFFFFF`, true-white
  surfaces (`--bg: #FFFFFF`, `--card-bg: #FFFFFF`) on a barely-off-white
  page bg, depth from shadow (`--card-shadow`) not from a tinted
  background — explicitly modeled on how Airbnb/Stripe/Linear's light
  modes work, not a "dye everything the brand color" approach.
- Dark theme: `--primary: #FF6B5B`, `--primary-hover: #FF8577`,
  `--primary-pressed: #E1483D`, `--on-primary: #1C1B1A`, near-black
  surfaces (`--bg: #1C1B1A`).
- `--khanjar` and `--gulf` variables **still exist** in `src/index.css`
  but are explicitly commented as legacy/no-longer-load-bearing —
  `--khanjar` is now just `var(--primary)`, `--gulf` is a teal kept only
  because a handful of venue/category call sites still reference it. If
  you see `--khanjar` or `--gulf` referenced somewhere, it does **not**
  mean the terracotta/amber system is still active; it's a back-compat
  alias.
- Variable *names* (`--bg`, `--primary`, `--card-bg`, `--accent`, etc.)
  were deliberately kept stable across every single one of these passes so
  the ~300 existing call sites across the app never needed touching — only
  hex values changed. This is a real, working pattern; keep doing it if
  the palette ever moves again.
- Category colors (`--cat-music`, `--cat-sports`, etc.) are a separate
  7-hue set, none purple, none competing with coral — untouched by the
  redesign churn above.

**Do not revert back to amber/khanjar-terracotta or attempt another
whole-app "colour and life" saturation pass without explicit new user
direction** — both were tried, both were explicitly walked back, and the
coral/Plus-Jakarta-Sans system is what an external, independently-authored
design reference converged on too. If a future ask is "make it more
colorful," treat that as a genuinely new request, not a reason to resurrect
either of the earlier failed directions.

Also shipped in this window, unrelated to color: a signature animated
"W" loading mark (`LoadingMark`, `3a59a67`) now used in every
`.route-loading` Suspense fallback across the app (indigo→violet→pink
gradient stroke animation — this one small piece of the old indigo
palette survives on purpose, as a loading-state accent, not the brand
color).

## 20. VenueOS — venue management promoted to its own dashboard

`2d1e42b` moved venue management out of `You.tsx`'s buried "Your venues"
profile tab into a real top-level dashboard: `src/pages/venue-os/
VenueList.tsx` (index) and `src/pages/venue-os/Workspace.tsx` (per-venue,
routes `/venue-os/:venueId/:tab`), mirroring the same pattern
`/organizer` already used (deep-linkable NavLink sidebar, not modal
sheets or internal `useState` tabs). Existing functionality (Reservations,
Calendar, Tables, Guests, Analytics, Hours) moved verbatim — that step was
pure restructuring, not new features.

New feature work stacked on top of the promotion, same session:
- **Table/seat picking** for both venues and events (`b6b8bb0`) —
  `FloorPlan`/`FloorTable` models, a canvas editor with auto-seat-
  assignment; `6e6b3ec` later fixed a `FloorPlanCanvas` scaling bug and
  unstyled inputs.
- **Expanded reservation dashboard** (`107d363`): calendar, guest history,
  analytics, walk-ins.
- **VenueOS Marketing** (`4012c1a`): segment-targeted campaigns to venue
  guests, via `server/venue-marketing.js`'s `resolveVenueSegment`; `3b32ff0`
  later wired marketing-copywriting principles into the AI assistant/agent
  prompts used to draft this copy.
- **VenueOS Venue tab** (`a7449fb`): business-profile editing.
- **Visual node-graph workflow automation builder** (`1c9d9d3`) —
  this is the single largest piece of new VenueOS scope this window.
  Replaced a flat trigger+action rules form with a real node-graph editor:
  draggable trigger/condition/action nodes, click-to-connect edges (live
  SVG lines), a per-node properties panel. Backed by new `Workflow`/
  `WorkflowRun` Prisma models (separate from the pre-existing
  `AutomationRule`, which stays as-is for its own event-side triggers —
  this was a deliberate parallel-model choice, not a migration/replacement).
  Execution (`server/venue-workflows.js`) walks the graph depth-first from
  the trigger node the instant it fires (reservation
  created/cancelled/no-show) — a failing condition prunes its whole branch,
  actions chain/fan out to multiple children — and every run is logged to
  `WorkflowRun` (matched/executed nodes, success/partial/failed), viewable
  per-workflow via a "Run history" toggle. This is the same execution
  pattern the in-progress Event Workflows work (§23) explicitly copies for
  parity on the organizer/event side.
- A dedicated `weyn-venue-dashboard` subagent now owns this surface (see
  `.claude/agents/` — pre-existing per the memory note on this repo).

Known small fixes along the way, not otherwise noteworthy: venue dashboard
needing multiple refreshes to appear (`a1123ed`), broken icons/conflicting
icon fonts (`ba2bd63`), an unstyled "new list" input and dark-mode-invisible
clear-x on Profile (`927fa14`).

## 21. Agentic AI Phase 1 → "AI Studio"

`b4b9e31` ("Add agentic AI Phase 1: tool-calling + approval-gated actions")
gave Weyn's AI assistant real tool-calling instead of only generating text:
Gemini's function-calling API drives a multi-turn loop
(`server/ai.js`'s `runAgentTurn`) over a small tool registry
(`server/agent-tools.js`).

- **Read-only tools** (`mutates: false` — `getUpcomingReservations`,
  `getRevenue`, `getCustomerHistory`, `findAvailableTables`, and their
  organizer-side equivalents) execute immediately during the chat turn.
- **Mutating tools** (`assignTable`, `createReservation`,
  `sendCampaignEmail`, etc.) **never** execute during the chat turn.
  Instead a new `AgentAction` row is created with `status: "proposed"`,
  and the tool's real `execute` only runs from
  `POST /api/organizer/ai/actions/:id/approve` (and the venue-side
  equivalent) after the owner explicitly reviews the exact arguments and
  the model's stated reasoning — mirrors the pre-existing Campaign
  "create as pending → approve/cancel → execute" pattern already in this
  codebase, not a new mechanism invented from scratch.
- Every tool executor **re-validates ownership server-side** regardless of
  what id the model supplies as an argument (see `ownedVenueIds()` in
  `server/agent-tools.js` for the pattern) — the model's own tool-call
  arguments are never trusted as proof of access, same rule every other
  route in this app already follows for client input.
- Explicitly scoped **down** from a much larger agentic vision the commit
  message itself lists as out of scope for Phase 1: 200+ tools,
  multi-agent specialization, an AI inbox, a command bar, cross-session
  memory. Don't assume any of that exists — it doesn't.
- The frontend surface for this is `src/pages/organizer/AiStudio.tsx`
  (and a venue-side equivalent under `venue-os/`) — later commits refer to
  this whole feature as **"AI Studio"** rather than "agentic AI Phase 1";
  same feature, renamed in later commit messages/UI copy as it matured, not
  two different things.
- Backing model: `AgentAction` in `prisma/schema.prisma` (~line 1039) —
  confirmed present in the current schema.

## 22. Landing page rebuild (waitlist.weynevents.com)

Beyond §1-§18's original landing-page build, this window did a substantial
rebuild pass, largely reusing/iterating on the same React Bits component
strategy already described in §12 (Ferrofluid/SplitText/RotatingText, all
lazy-loaded, all confined to the waitlist page's own chunk):

- **`9b89de2`**: integrated `GlassSurface` (frosted-glass panel over the
  Ferrofluid hero, with the library's own non-Safari/Firefox SVG
  backdrop-filter fallback), `CardSwap` (replaced a ScrollStack
  "What you get" section with an auto-cycling 3D card stack — ScrollStack
  removed entirely), and `FloatingLines` (a moving line accent above the
  "How Weyn was created" section, deliberately masked to a short band
  rather than full-height — full-height caused a bright beam to sweep
  across and obscure body text).
- **`32167e8`** ("Redesign waitlist landing: glassmorphism, fixed rotating
  text, proper CardSwap"): replaced the GlassSurface SVG-displacement
  experiment with a plain-CSS `.glass-panel` recipe (translucent surface +
  backdrop blur + hairline + inner highlight) — theme-aware for free since
  it mixes from existing tokens, and actually works in Safari/Firefox
  where the SVG filter silently fell back anyway. Also fixed
  `RotatingText` breaking onto its own left-aligned line when inlined
  mid-sentence (it's a block-level flex container; now sits on its own
  flex-centered line). **A pre-rebuild backup lives on git branch
  `backup/landing-v1`** if any of this needs to be compared against or
  rolled back.
- Real AI-generated cover art added to "Cover Art Concepts" (`60150c9`).
- Brand story/vision copy expanded multiple times (`3df7b87`, `b2d7049`)
  and outdated marketing screenshots refreshed.
- Waitlist emails added, plus mobile/copy fixes (`6d725fa`); a PWA
  bottom-space bug and a redundant top branding bar removed (`cc90f09`).
- Admin dashboard gained visibility into waitlist signups (`2dbb2d6`).
- **PostHog deferred**: `0c24f42` ("Defer PostHog init and disable unused
  feature-flag fetch") — PostHog itself was already live per §9 of the
  2026-07-08 baseline, but its init was deferred further and an unused
  feature-flag fetch disabled, presumably for load-time reasons. Not a
  reversal of §9, an optimization on top of it.

## 23. Critical bugs fixed this window

Beyond the redesign work, several real production bugs were found and
fixed, three of which turned out to be **layers of the same underlying
"reload the site" bug** on `/e/:id` (event detail), fixed in sequence:

1. **`f9799d0` — private-beta gate broke every direct page navigation.**
   The `PRIVATE_BETA` allowlist middleware ran globally and only
   recognized auth via a Bearer token; a plain top-level page load (shared
   event link, browser refresh, return from a payment redirect) never
   carries one, so every direct visit to `/e/:id` — the core "share this
   event" loop, and where ticket booking lives — hit the gate with no
   token and got a raw JSON 403 instead of the app. Fixed by scoping the
   gate to `req.path.startsWith("/api/")` (its actual intent), not by
   removing it.
2. **`e62db1c` — Clerk failing to load on server-rendered routes (CSP
   `scriptSrc`).** Second half of the same bug: once the 403 was fixed,
   the page still blanked forever because Clerk's React SDK lazy-loads
   its actual JS at runtime via a dynamically injected `<script>` tag from
   Clerk's Frontend API host, and this app's Helmet CSP only allow-listed
   Clerk's hosts in `connectSrc` (for XHR/fetch), not `scriptSrc` — silently
   blocked. Root `"/"` never showed this because Vercel serves it as a
   static file, bypassing this Express app (and its CSP header) entirely;
   `/e/:id` is deliberately routed through the app for OG-tag injection, so
   it was the one page that actually hit the restriction.
3. **`12f5ad1` — the actual crash underneath: hooks called after a
   conditional early return.** Once the two fixes above got `/e/:id`
   rendering again, this exposed `EventDetail` calling `useAsync` and
   `useState` **after** its loading/error early returns — a textbook React
   error #310 ("Rendered more hooks than during the previous render"),
   caught by `ErrorBoundary` and shown as "Something went wrong —
   reloading usually fixes it" on every single event-page view once data
   finished loading. **Lesson for future hook-order bugs**: check for
   early returns positioned before hook calls in the same component,
   especially in components that render a loading state.
4. **`a512834` — private-beta gate bypass via `waitlist.weynevents.com`
   hostname, CRITICAL, confirmed exploitable in production.** The gate's
   exemption for the waitlist hostname (§10 of the 2026-07-08 baseline)
   checked only `req.hostname` and waived the 403 for **every** `/api/*`
   route on that hostname, not just `POST /api/waitlist` — since Express
   dispatches purely by path (the Host header doesn't change which
   handler runs), any route reachable on `weynevents.com` was equally
   reachable via a one-word hostname swap with no spoofing needed (that
   hostname is already public DNS). Verified live before fixing:
   `GET /api/events` returned real data and `POST /api/events/:id/book`
   reached live booking logic via the waitlist hostname while identical
   requests 403'd on the main domain. Fixed by scoping the exemption to
   exactly `POST /api/waitlist`. **If §10's waitlist-hostname exemption is
   ever touched again, scope any new exemption to the specific route(s)
   that need it — never to "this hostname, all routes."**

Also: `Onboarding`'s Social-preference step (solo/friends/date night) was
cut entirely (6 steps → 5, `c9d901a`) — nothing downstream consumed it,
only Interests fed the personalized preview — and PostHog funnel
instrumentation was added across every onboarding step
(`onboarding_step_viewed`/`_completed`, `onboarding_location_granted`/
`denied`, `onboarding_signup_clicked`, `tonight_view_opened`) per an
explicit "Business Plan §13" prerequisite referenced in that commit — that
business-plan doc wasn't located during this pass; if you need it, ask
whoever wrote that commit or check for it outside this repo.

## 24. Uncommitted / in progress right now — do not describe as shipped

**Everything in this section is sitting in the working tree, uncommitted,
as of 2026-07-12.** It has not been deployed. Treat it as a checkpoint a
session left mid-task, not a finished feature — verify it's still there
(`git status --short`) before trusting this description, and don't assume
it's live in production.

Modified: `prisma/schema.prisma`, `server/app.js`, `server/marketing.js`,
`src/api.ts`, `src/pages/organizer/EventWorkspace.tsx`. New/untracked:
`server/event-workflows.js`, `prisma/migrations/
20260712210000_marketing_social_kit/`, `prisma/migrations/
20260712210500_add_event_workflows/`.

### 24.1 Marketing "social kit" — appears functionally complete

Extends the existing per-event AI marketing-copy generator
(`server/marketing.js`) with:
- **Instagram/WhatsApp Story text** (`instagramStory` — short, no
  hashtags, ends with a call to tap the link) and a **warmer WhatsApp
  broadcast-list variant** (`whatsappBroadcast`, distinct tone from the
  existing group-chat message) — both nullable additions on
  `MarketingAsset`.
- **A T-7/T-3/T-1/day-of countdown posting schedule** (`schedule`, JSONB
  array) — dates are computed in plain arithmetic off `event.startsAt`
  (`scheduleDates()`/`withScheduleDates()` in `server/marketing.js`),
  **never** by the AI/template copy generator, specifically so the dates
  stay correct regardless of which copy source (AI or template fallback)
  supplied the post text.
- Frontend: `EventWorkspace.tsx`'s `MarketingTab` renders a new
  "Posting schedule" section (`PostingScheduleSection`) — one card per
  countdown stage with a copy button, same "AI drafts, human publishes"
  pattern as the rest of this tab (deliberately not auto-posted).
- Migration `20260712210000_marketing_social_kit` adds the three new
  `MarketingAsset` columns — additive/nullable, existing rows stay valid
  until next regenerate. **Not yet applied to any database** (uncommitted
  migration file only) — run `prisma migrate deploy` (or `db execute`,
  matching this repo's established pattern of hand-applying migrations
  against the live DB) before this can work against real data.
- This slice looks close to done: schema, backend copy generation, API
  types (`MarketingScheduleItem` in `src/api.ts`), and frontend rendering
  are all present and appear to line up end-to-end. What's unverified: it
  hasn't been run against a live/dev database (migration unapplied) or
  visually checked in a browser.

### 24.2 Event Workflows — organizer-side node-graph builder, now feature-complete end-to-end (updated 2026-07-12, later same day)

**Correction to the previous version of this note**, which described this
as "engine-only, no UI yet, CRUD routes not written." That was accurate at
the time it was written; a later pass the same day finished it. Re-verified
just now by reading the actual diff/files (not by trusting the old note) —
`git status --short` in this repo, plus a clean `npx tsc -b` (zero errors),
is what this section is based on.

This is **explicitly modeled on VenueOS's node-graph workflow builder**
(§20), full parity per the plan at (whichever session builds this next
should check whether `~/.claude/plans/sharded-scribbling-otter.md` still
exists on the machine that ran this — it has the full original spec for
both the organizer build below and the still-unstarted venue-side upgrade
in §25) — a deliberate parallel model, not a polymorphic reuse of the
existing `Workflow`/`WorkflowRun` tables (those require a `venueId`; the
two domains share almost no vocabulary).

**What exists and appears done:**
- Prisma models `EventWorkflow`/`EventWorkflowRun` (migration
  `20260712210500_add_event_workflows`) — same node/edge JSON shape as the
  venue side. Per `npx prisma migrate status`, this migration is **not**
  in the "not yet applied" list (only the unrelated
  `20260712210000_marketing_social_kit` is) — meaning it looks like it's
  already applied to the live Neon DB. Couldn't confirm by direct query
  from this session (no DB network access in this environment,
  `ECONNREFUSED`) — **verify with a real query before assuming**, e.g.
  `psql` or a Prisma script from a machine that can actually reach Neon.
- `server/event-workflows.js` — trigger catalog (`ticket_sold`,
  `low_inventory`, `event_published`, `waitlist_joined`,
  `promo_code_used`), condition fields (`ticketTier`, `quantityRemaining`,
  `attendeeEmailDomain`), action catalog (`notify_team`, `send_campaign`,
  `apply_promo_code`, `add_to_waitlist_priority`), `validateEventWorkflowGraph`,
  and the same DFS walk/prune/chain execution engine as
  `server/venue-workflows.js`. Also exports `redeemPromoCode()` — closes a
  real pre-existing gap (`POST /api/promo-codes/validate` only ever
  checked a code; nothing incremented `PromoCode.usedCount` anywhere) using
  the same atomic conditional-UPDATE pattern as `db.claimTierCapacity`.
  Deliberately doesn't touch checkout pricing (promo codes were never
  wired into `priceFor()` — a separate, still-open gap, out of scope here).
- All five triggers are wired as fire-and-forget (`.catch(() => {})`)
  calls in `server/app.js`: `event_published` after the publish route's
  `isDraft: false` update; `ticket_sold`/`low_inventory` after all three
  `issueTickets`-adjacent booking-confirmation paths (free RSVP,
  organizer-payment confirm, PayTabs webhook confirm); `waitlist_joined`
  after waitlist entry creation; `promo_code_used` from `redeemPromoCode()`
  called at actual booking creation (not at validate-time).
- **CRUD routes exist** (grep-confirmed, not dead code):
  `GET /api/organizer/workflows` (cross-event list, mirrors
  `GET /api/organizer/automations`'s optional `eventId` filter),
  `GET/POST/PUT/PATCH/DELETE /api/events/:id/workflows[...]`, and
  `GET /api/events/:id/workflows/:workflowId/runs` — all gated with
  `requireEventOwner()` + `requireFeature("eventWorkflows")`.
  `validateEventWorkflowGraph` is called from the POST and PUT handlers.
- **Frontend UI exists**: `src/pages/organizer/Workflows.tsx` (380 lines),
  a new "Workflows" nav entry in `Layout.tsx` (sibling of
  Overview/Events/Attendees/AI Studio/Settings — cross-event, not nested
  under a single event, per the plan's reasoning), and the route wired in
  `main.tsx`.
- `AutomationSection` in `EventWorkspace.tsx` (the old flat
  `capacity_threshold` rule form) got a "Legacy — see the new Workflows
  tab" note linking to `/organizer/workflows`, and was otherwise left
  fully intact — `AutomationRule`/`runAutomationScan`/its cron are
  untouched, per the plan's "run in parallel, don't auto-migrate"
  decision.
- `"eventWorkflows"` added to `FEATURES` in `server/features.js`; the
  migration seeds `FeatureAccess` rows (`plan_free: false`,
  `plan_pro: true`) matching the existing pattern.
- `server/app.js` gained `sendEventNotificationNow()`, extracted to module
  scope from the existing `POST /api/events/:id/notify` handler so
  `send_campaign` reuses the exact bulk-notify fan-out — the route itself
  was refactored to call this shared function, behavior unchanged.
- `WaitlistEntry` gained a `priority` column (int, default 0), written by
  `add_to_waitlist_priority`.
- A pre-existing DB drift item was discovered and documented (not
  introduced) while building this: `Payment.stripeSessionId` exists on
  the live DB but was undeclared in `schema.prisma` — same category as
  §4.1's note about orphaned trigram indexes. Now declared as a
  comment-flagged legacy column; **do not let `prisma migrate diff` drop
  it.**

**Still worth checking before calling this fully shipped:**
- Nothing here has been committed — it's all working-tree changes
  (`git status --short` still shows the same modified/untracked file list
  as before). Review the diff and commit deliberately, don't assume a
  commit already happened.
- Never exercised end-to-end against a live/dev DB from a real browser —
  build/typecheck are clean, but nobody has actually created an
  `EventWorkflow`, sold a ticket against it, and watched an
  `EventWorkflowRun` row + real email land. Do that before trusting this
  in production.
- `npx prisma migrate status` also shows unrelated pre-existing drift:
  the DB has a `20260705190000_add_stripe_payment_field` migration applied
  that isn't in this repo's `prisma/migrations/` folder at all. Not
  introduced by this work, but worth resolving (`prisma migrate resolve`
  or regenerating the missing migration file) before anyone runs
  `prisma migrate dev` again in this repo — an unresolved drift can make
  `migrate dev` prompt to reset the dev database.
- The optional "Convert existing AutomationRule → EventWorkflow" button
  described in the original plan was deliberately skipped as out of scope
  for this pass — still not built, still a reasonable follow-up.

## 25. Venue Workflows UX upgrade — planned, not started

The other half of the same effort that produced §24.2 above. Full spec
lives in a plan file written during that planning session:
`~/.claude/plans/sharded-scribbling-otter.md` (on whichever machine ran
that Claude Code session — check it's still there; if not, this section
is the fallback summary). Nothing in this section has been touched — no
venue-os files appear in `git status` beyond what's listed in §24.

Goal: usability upgrades to the **already-shipped** Venue OS Workflows
tab (§20) — auto-layout, templates, guidance, and an expanded
trigger/condition/action catalog. Four areas, in priority order:

1. **Auto-layout & cleaner canvas** — a BFS-depth "layered" auto-arrange
   (new `src/lib/workflowLayout.ts`, `layoutGraph()`), one-click button in
   `WorkflowEditor` (`src/pages/venue-os/Workspace.tsx`), not automatic on
   every edit. Snap-to-grid in `WorkflowCanvas.tsx`'s drag handler. Zoom
   via a simple scale multiplier + native scroll-to-pan (skip true
   pan/zoom state — not worth the complexity for graphs this small).
2. **Workflow templates** — a hardcoded array of ~6 starter graphs (e.g.
   "notify me on large parties," "auto-tag VIP no-shows," "cancellation
   follow-up" demonstrating action-chaining) using only the existing
   catalog. Requires loosening `WorkflowEditor` to accept an
   un-persisted `initial` graph (currently assumes a saved `workflow.id`
   always exists) so a template can seed the editor before the first
   save.
3. **Guidance/empty states** — description maps for triggers/conditions/
   actions shown contextually in the node detail panel; a real onboarding
   empty state instead of the current one-liner; and a client-side
   "this node isn't connected to the trigger yet" warning (reusing
   `layoutGraph`'s reachability computation) — the one actual gap found
   in an otherwise-working validation-error-surfacing path.
4. **Expanded catalog** — honest split: `reservationSource` and
   `reservationNotes` condition fields are same-day additions (real
   columns already on `Reservation`); a `send_guest_sms` action should be
   added as a visible-but-stubbed catalog entry (`ok:false, "not set up
   yet"`) since **no SMS provider exists anywhere in this codebase**
   (grepped, zero hits) — don't fabricate a working send. A time-based
   `reservation_upcoming` trigger needs a genuine scheduler (the current
   engine is explicitly event-driven only) — follow the existing 5-min
   Cloudflare cron pattern (`runReminderScan`-style) plus a
   `@@unique([workflowId, trigger, reservationId])` migration on
   `WorkflowRun` for idempotency; sequence this last, or ship it behind a
   disabled "coming soon" state.

Two project-scoped Claude Code subagents exist for this kind of work —
`weyn-organizer-dashboard` and `weyn-venue-dashboard` (`.claude/agents/` in
the marketing-assets folder at `~/Downloads/dhairya`, not this repo) — use
`weyn-venue-dashboard` for this section.

## 26. §25 actually shipped, plus Marketing Hub + growth suite (organizer & venue)

Contrary to §25's "not started," `9eb0157` shipped all four Venue Workflows
areas as planned (`src/lib/workflowLayout.ts`, template picker, guidance
maps, `send_guest_sms` stub, `reservationSource`/`reservationNotes`
conditions). No migration needed for B4 (existing nullable columns).

Marketing Hub landed as two parallel builds, organizer then venue mirror:
- `0d73e6c` — organizer Marketing Hub (`/organizer/marketing`): ad-copy gen
  (Google/Meta/press/influencer DM), UTM builder, referral leaderboard,
  cross-event calendar, brand kit. New tables (`MarketingLink`,
  `ReferralCode`, `OrganizerBrandKit`) via hand-written migration
  `20260713090000_marketing_hub` — **not yet applied to the DB** per its
  own migration comment (confirmed still parked as of the current
  uncommitted migration notes below).
- `3cf0c5c` — venue mirror: win-back tracking, loyalty/referral tiers
  (`VenueLoyalty`), UTM links, calendar, brand kit. Migration
  `20260713100000_venue_marketing_hub`, also unapplied.
- `fa038b0` / `d9f0a7b` — real growth suite on both sides: Meta
  (Instagram+Facebook) OAuth connect with AES-256-GCM token encryption
  (`server/crypto-secrets.js`) and real Instagram Graph API posting, plus
  an owned email-subscriber list with real one-click unsubscribe and
  batched Resend campaign sends. Every Meta/encryption path is gated on
  unset env vars (`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`,
  `SOCIAL_TOKEN_ENC_KEY`) — dormant by design, nothing fires. Their
  migrations (`organizer_social_connections`, `venue_social_connections`)
  are likewise unapplied. `d9f0a7b` also makes `SocialAccountConnection`
  dual-owned (userId/venueId).

No Playwright or manual click-through evidence found in any of these
commit messages — verification claims in the messages themselves are
scoped to "additive migration," "gated behind env vars," etc., not to
actually exercising the UI. Treat all Marketing Hub / growth-suite UI as
build-verified only unless someone confirms otherwise.

## 27. Editorial design pivot saga — net result is Editorial, recolored

Three commits, same evening (Jul 13, ~21:37-21:46), do NOT each represent a
shipped state — only the last one reflects what's live:

1. `5c778bd` — swapped the whole design system from the coral "Editorial"
   direction to a "Premium Utilitarian Minimalism" system: warm off-white/
   near-black canvas, muted pastel-blue accent, Instrument Serif for
   headings only, radii capped at 12px. Backed up first (`backup-pre-
   minimalist-ui` branch/tag + a filesystem tarball, per the commit
   message) — a sign the author expected this might get reverted.
2. `17cdaf1` — reverted `5c778bd` wholesale (`git revert`), same evening,
   5 minutes later. Commit message is just the auto-generated revert text;
   no stated reason in-repo, but the timing (reverted within minutes of
   landing) reads as an immediate "no, go back" call after seeing it,
   not a bug. Touches only `index.html`, `LoadingMark.tsx`,
   `styles/components.css`, `styles/tokens.css`.
3. `1e92479` — on top of the revert (i.e. back on Editorial), recolored
   the accent from coral (`#FF5A3C`) to muted blue (`#1F6C9F` light /
   `#6FB6E0` dark) — the one piece of the minimalist palette that survived.
   Explicitly framed as "kept the Editorial layout/shapes... just a
   different hue."

**Net effect**: the app runs the Editorial layout (pill nav, hero card,
12px+ radii were never capped since the cap reverted too) with a blue
accent instead of coral or the minimalist pastel-blue. If anyone reads
`5c778bd` in isolation they'll think Premium Utilitarian Minimalism
shipped — it didn't stay. No visual/Playwright verification cited for any
of the three.

## 28. UI overhaul, CSS split, redesign passes (Uber/Instagram/Airbnb pivot)

Before the Editorial pivot above, a separate visual system was built and
partially superseded by it — worth knowing this history exists even though
Editorial is what's live now:

- `9d9ebc2` — "Uber/Instagram/Airbnb-inspired" overhaul: sharp red accent
  on near-black/near-white, flatter elevation (hairline borders, tighter
  radii), native system-font stack replacing bundled Plus Jakarta Sans,
  non-bounce easing. Also folded in two previously-uncommitted features:
  per-event marketing social kit and organizer-side Event Workflows
  (parity with VenueOS's builder).
- `52beac4` — mechanical split of the 2708-line `src/index.css` into
  `src/styles/{tokens,base,components}.css` (commit claims diff-verified
  content-identical, zero rule changes) plus a real bug fix: `--f-display`
  was hardcoding the system-font stack despite Plus Jakarta Sans being
  loaded, and a brand-red mismatch between favicon/manifest (`#E1483D`)
  and the `--primary` token (`#FF3B30`) was reconciled to one color.
- `e675d87` — tinted-shadow/asymmetric-radius/gradient-accent tokens,
  hover polish on dashboard surfaces, Explore hero SplitText reveal, and
  extraction of a shared `DashboardShell` out of three copy-pasted nav
  implementations (`organizer/Layout.tsx`, `organizer/EventWorkspace.tsx`,
  `venue-os/Workspace.tsx`).
- `d272ee0` — hero-stat tile (net-revenue tile gets tinted bg, larger
  figure, spans 2 cols) and `.dash-banner` gradient-accent border.

This whole red/flat system was largely obsoleted by the Editorial pivot
(§27) and its later coral→blue recolor — current live styling is Editorial
+ blue, not this red/flat system. `src/styles/tokens.css` and
`components.css` are the files to check for what's actually active.

## 29. Onboarding funnel cut + Discover/nav visual work

- `c9d901a` — cut the Social-prefs (solo/friends/date-night) onboarding
  step entirely (6 steps → 5): nothing downstream read it, only Interests
  fed the preview filter. Added PostHog instrumentation across
  `Onboarding.tsx`, `Explore.tsx`, `EventDetail.tsx`,
  `CheckoutSuccess.tsx`: `onboarding_step_viewed/_completed`,
  `onboarding_location_granted/denied`, `onboarding_signup_clicked`,
  `tonight_view_opened`, `ticket_booked` (fired on real paid status, not
  the checkout redirect).
- `3aece8f` → `474e8aa` (10 commits) — Discover page + navbar visual
  pass: real SVG-refraction "liquid glass" navbar, spring-physics hero
  carousel and category selector (`baa491c`), single rotating featured
  spotlight replacing a static hero (`3c5398f`, later simplified further
  in `0d34058`), colorized category circles, filled-vs-outline icon swap
  on tab selection, sliding highlight pill behind the active tab. `65646d5`
  is explicitly framed as a "restraint redesign pass... per pro design
  review" — i.e. a walk-back of some of the earlier glass/motion
  intensity. The tail end (`c2f9be6`, `f3fe183`, `474e8aa`) is bug-fixing
  against a reference recording: veil opacity too transparent, ticket icon
  changing shape on fill, sparkles icon using the wrong glyph (4-point
  diamond instead of the real 5-point star — fixed with the correct
  polygon), and tab icons dimming when inactive when they should always
  stay full-white with only the label dimming. No Playwright/automated
  visual check cited — these read as manual comparison against "the
  reference recording" mentioned repeatedly in commit messages, not
  automated verification.

## 30. AI Studio image-generation removed (not added)

`70667a7` — this is a **removal**, not a feature. Gemini's prepaid image
credits are depleted, so rather than ship a broken "Generate image" button,
the Cover-art-concepts tool was deleted outright: `server/ai.js` drops
`generateImage()`/`imageGenConfigured()`/`GEMINI_IMAGE_MODEL`; `server/
app.js` drops the `.../ai/cover-concept` and `.../ai/cover-image` routes;
`src/api.ts` drops the two client calls; `AiStudio.tsx` drops the
`CoverConceptTool` component. Vision-based tools (focal-point suggestion
on uploaded photos) are unaffected — that's analysis, not generation, and
doesn't share the billing dependency.

## 31. Organizer Pro cancel flow

`406ed03` — SubscriptionCard → survey → dynamic save offer → confirmation,
per the churn-prevention playbook. Offer branches by stated cancel reason:
`too_expensive`/`switching` → 25% discount, `not_using`/`temporary` →
pause (1-3 months, auto-resumes), `missing_feature` → feature-unlock nudge,
`technical_issues` → routed to support first, `other` → straight to
confirmation. No real billing exists yet (`Subscription.stripeSubscriptionId`
is still a null placeholder) — built against the existing model so it can
wire into Stripe later without a shape change: cancel sets
`cancelAtPeriodEnd`, pause flips `status` to `SUSPENDED` with a
`pausedUntil` that `ensureSubscription()` lazily auto-resumes past (no
cron), save-offer acceptance is logged but doesn't yet apply a real
discount/downgrade (flagged as the one piece to wire once Stripe exists).
`cancelReason`/`cancelFeedback` are recorded on every path for
reason-distribution reporting.

## 32. UNCOMMITTED — venue waitlist + check-in/shifts/budget/transfers/sponsor-ROI

**Not committed, not reviewed, not verified. This is working-tree state
only** — `git status --short` on 2026-07-14 shows modified: `prisma/
schema.prisma`, `server/app.js`, `server/db.js`, `server/event-workflows.js`,
`server/index.js`, `server/worker.js`, `src/api.ts`, `src/pages/organizer/
EventWorkspace.tsx`, `src/pages/organizer/MarketingHub.tsx`, `src/pages/
venue-os/Workspace.tsx`; untracked: `prisma/migrations/
20260714090000_venue_waitlist/`, `prisma/migrations/
20260714100000_checkin_shifts_budget_transfers_sponsor_roi/`, `.agents/`,
`.claude/skills/`, `skills-lock.json`.

From the migration files and schema diff, this looks like two batches:

- **Venue reservation waitlist** (`VenueWaitlistEntry` model, new
  `VenueWaitlistStatus` enum: WAITING/NOTIFIED/CONVERTED/EXPIRED/
  CANCELLED) — a guest joins a waitlist for a fully-booked slot, can be
  promoted into a real `Reservation`. Migration note says it was applied
  directly via `prisma db execute` + `migrate resolve --applied` (Neon
  pooled connection can't do shadow-DB `migrate dev`) and explicitly does
  **not** touch the four already-parked-unapplied migrations from §26
  (marketing_hub, venue_marketing_hub, organizer_social_connections,
  venue_social_connections) — those stay parked.
- **Organizer batch** — QR check-in scanning (new `CheckIn` model +
  `CheckInStatus` enum: VALID/DUPLICATE/INVALID, distinct from
  `Ticket.checkedInAt` which only tracks current state — this is an
  append-only scan log), ticket transfers (`Ticket.transferredToEmail/
  transferredAt/transferredBy` — relabeling only, same ticket code still
  admits), staff shift scheduling (`EventShift` linked to
  `EventTeamMember`), budget tracking with per-category alerts (`Budget`
  model, loosely tied to `Expense` by matching `category` strings, not an
  FK). The migration's own header says this covers 5 of 9 planned
  features — group discounts (`PromoCode.minQuantity`, already in this
  same migration despite the header text), QR flyer generator, NPS survey,
  and birthday automation (`MarketingContact.birthday` column added to
  schema but the table doesn't exist in the DB yet — parked behind
  marketing_hub). "Sponsor ROI" is named in the migration folder but not
  yet visible in the schema diff reviewed here — check `server/app.js`'s
  diff directly for that piece before assuming it's done.

None of this has been typechecked, tested, or clicked through in this
review — it's a description of intent inferred from the diff, not a
verification. Before committing: confirm the actual routes exist for each
model in `server/app.js`, run `npx prisma migrate status` to check what's
really applied vs parked (§26 already has four migrations sitting
unapplied — don't let this be a fifth without tracking it), and do at
least a build/typecheck pass.

## 33. OneSignal replaces the hand-rolled APNs/VAPID push system (2026-07-14)

App ID `12d86179-e14e-4257-8575-2b11e272cc8a`. Note: this app is a Vite/
React web PWA + **Capacitor** iOS wrapper, NOT React Native — OneSignal's
React Native doc/package (`react-native-onesignal`) does not apply here;
used `onesignal-cordova-plugin` (native/Capacitor) + `react-onesignal`
(web) instead.

- **Targeting model changed**: server now sends by Weyn's own `User.id`
  as an OneSignal *external ID*, not by raw device token/VAPID
  subscription. OneSignal owns subscription management client-side; the
  app no longer needs to collect or store tokens itself.
- **New**: `server/onesignal.js` — `sendOneSignalPush(externalUserId,
  {title,body,data,url})` + `oneSignalConfigured()`. Same dry-run
  convention as the code it replaced: with `ONESIGNAL_REST_API_KEY`
  unset, logs `[onesignal:dry-run] would notify...` and returns
  `{sent:false, reason:"not-configured"}` — nothing breaks with zero
  OneSignal credentials configured, which is the current state.
- **Deleted**: `server/push.js` (raw APNs/`@parse/node-apn`),
  `server/webpush.js` (raw VAPID/`web-push`). Removed from `server/app.js`:
  `POST /api/push/register`, `GET /api/push/vapid-public-key`,
  `POST /api/push/web-subscribe`, `POST /api/push/web-unsubscribe`;
  `notifyUser(userId, ...)` now calls OneSignal directly.
  Anonymous/device-only booking flows (no Weyn `userId` available) had
  their push calls dropped — email confirmation already covers those,
  not a regression.
- **Client**: `src/push.ts` rewritten — native branch uses
  `onesignal-cordova-plugin`, web branch uses `react-onesignal`, same
  `Capacitor.isNativePlatform()` branch point as before. Exports
  `initPush()`, `requestWebPushPermission()`, `identifyPushUser(userId)`,
  `clearPushUser()`. `src/main.tsx`'s `ClerkAuthBridge` now fetches
  `/api/me` and calls `identifyPushUser`/`clearPushUser` on sign-in/out —
  `src/store.ts`'s `Account`/`useAccount()` gained an `id` field (Weyn's
  own id, distinct from Clerk's) to make this possible.
- **`PushToken`/`WebPushSubscription` Prisma models kept but now dead** —
  deliberately not migrated away, no schema change. Fine to drop in a
  later cleanup pass once OneSignal is confirmed working in production.
- **Env vars**: `.env.example` gained `VITE_ONESIGNAL_APP_ID` +
  `ONESIGNAL_APP_ID` (both pre-filled with the real App ID above) and
  `ONESIGNAL_REST_API_KEY=` (empty — **needs a real key from the
  OneSignal dashboard before any push actually sends**, everything ships
  in dry-run mode until then). CSP/helmet in `server/app.js` updated to
  allow OneSignal's domains.
- **Verified**: `npx tsc -b` and `npm run build` both pass; grepped clean
  for leftover `@parse/node-apn`/`push.js`/`webpush.js`/old routes.
  **Not verified**: no real `ONESIGNAL_REST_API_KEY` or physical iOS
  device available in this environment, so actual push delivery was never
  exercised end-to-end — do that before trusting this in production.
- **Still needed, manual, not done here**: `npx cap sync ios` to pull the
  Cordova plugin's native pod into the Xcode project, and confirm the
  existing Push Notifications + Background Modes capabilities (left over
  from the old `@capacitor/push-notifications` setup) still satisfy
  OneSignal's native requirements.
- **Uncommitted**: like §32, none of this is committed — it lands on top
  of an already-dirty working tree (venue waitlist / check-in / budget
  work from §32 is still sitting there too). Review and commit
  deliberately, don't assume either is already landed.

## 34. Consumer-app rebuild pass (2026-07-18) + District/Platinumlist feature audit

*Multiple Claude Code sessions worked in this same working tree concurrently
during this pass — expect to see direct-to-`main` commits under "Dhairya
Saluja" interleaved with council-workflow commits. That's not drift, it's two
sessions coordinating live.*

### What shipped, in order, each its own commit on `main`

1. **Home feed rebuild** (`8e009fe`) — personalized-feed HomeFeed.tsx +
   HorizontalRail.tsx, then **reverted** (`f82360b`) because it showed
   mostly-empty sections (Recently Viewed/Friends Are Going/Popular
   Organizers) to any zero-history user — a real regression. **Not
   re-fixed** — deferred at the user's explicit instruction. If picked back
   up, the fix is: hide/skip sections that would render empty rather than
   showing them sparse, and prioritize sections that always have content
   (Trending/Near You/Tonight/Free) first so new users still see a full feed.
2. **Search page** (`92a3f24`) — new `/search` route, unified event+venue
   search, category/when/price bottom-sheet filters, recent + popular
   searches, lightweight client-side NL query parsing
   (`src/utils/queryParser.ts` — no LLM). Still live, not reverted.
3. **Discovery rebuild** (`c26109b`) — category grid + collection rails,
   then **reverted** (`b29a839`) because it replaced Discover's real
   Events/Venues toggle + embedded Explore with a standalone icon grid,
   orphaning the actual search/filter page and the Venues tab. Current
   `Discover.tsx` is back to the toggle + `<Explore embedded />`, with icon
   coloring switched from a CSS filter (muddy/unreliable) to a colored glyph,
   plus a `>=900px` desktop row layout. Don't re-attempt the category-grid
   replacement — if curated collections (Date Night, Free, etc.) are still
   wanted, they need to live *alongside* the real Explore page, not replace it.
4. **Maps page** (`9b5b09a`) — new `/map` route, Google Maps (reuses the
   existing `google-maps.ts` loader, not a new library), client-side grid
   clustering (`src/utils/clustering.ts`), `EventPinSheet` bottom sheet on
   pin tap, opt-in geolocation blue dot. Heatmap, live attendance, and
   nearby restaurants/parking/hotels are noted as backend/API-scope gaps in
   `BACKEND_TODO.md`, not built — no Places API wired, no check-in-count
   endpoint, no attendance model.
5. **Event Card + Event Page upgrade** (`f49162a`) — real verified/
   selling-fast/only-N-left badges on `Stub.tsx` (backed by real
   `organizerVerified`/ticket-inventory fields), a new public
   `GET /api/event-venues/:id` for parking/accessibility display on
   EventDetail, a Contact Organizer sheet. A CSS regression from the
   automated pass (badge-group wrapper broke the old
   `.ec-card-cover > .ec-badge` direct-child selector) was caught and fixed
   in the same commit. Reviews, weather, video/reel, AI summary, FAQ are
   *not* built — no backing data model, intentionally skipped rather than
   faked.
6. **AI Concierge** (`64e6882`) — new `/concierge` page + `POST
   /api/concierge`, genuinely LLM-backed (reuses `server/ai.js`'s existing
   multi-provider helper), rate-limited 10/15min, every returned event id
   validated server-side against the real query results before responding
   (no hallucinated events possible). Restaurant/parking/transport legs of
   the itinerary are scoped out — no restaurant-specific data model exists.
7. **Social features (partial)** — Friends page + Who's Going attendee
   avatars (`b0c8ef1`, by the other session). **Privacy fix applied this
   session**: the public `/api/events/:id/attendees-summary` endpoint
   originally returned real attendee full names to *any* unauthenticated
   caller; changed to compute initials server-side (`server/db.js`
   `attendeesSummary`) so raw names never leave the server. Group
   booking/split payments, event chat/comments, stories/post-event photos
   are **not built** — no real chat/comments/stories data model exists;
   properly scoping any of these needs a schema migration, not a quick pass.

### District/Platinumlist feature audit (`FEATURES.md`, by the other session)

The user asked for "ALL the features of District and Platinumlist." Before
building anything, the other session audited the actual schema (130 Prisma
models) and routes (~200) and found **Weyn already implements essentially the
entire combined feature set of both** — this is a mature codebase, not one
missing features. Read `FEATURES.md` in full before adding anything from
either platform's feature list — check there first, don't re-build something
that already exists (that's how the App/Discovery reverts above happened).

Only **6 genuine gaps** were identified and built this session (`2a4f508`):

1. **Invoice/receipt PDF** — `server/invoice.js` (pdfkit), buyer route gated
   on `accessToken` (`GET /api/bookings/:id/invoice.pdf`), organizer route
   gated on event ownership (`GET /api/events/:id/bookings/:bookingId/invoice.pdf`).
2. **Paid seat-selection checkout — real bug fix, not a new feature.** The
   seat picker in `EventDetail.tsx` only ever loaded for free events
   (`ePayPrice === 0` gate), and `Checkout.tsx` never forwarded the selected
   seat to the server at all — paid reserved-seating checkout silently
   dropped the seat. Now: `Checkout.tsx` forwards `selectedSeatId`,
   `POST /api/events/:id/checkout` atomically claims it (`UPDATE "FloorSeat"
   ... WHERE status='available'`, preventing double-booking), releases it on
   payment failure/abandonment, issues a real `Ticket.seatId` row on success.
3. **Custom booking-form builder** — `Event.checkoutFormFields` (organizer-
   defined extra fields: text/email/phone/dropdown/checkbox),
   `Booking.customFieldValues` (buyer answers), validated server-side at
   checkout, `src/components/CheckoutFormFields.tsx` renders them, `PATCH
   /api/events/:id/checkout-form` for organizers to edit the field list.
4. **Multi-currency display polish** — `Event.currency` (real new column,
   defaults `"OMR"` — FEATURES.md's claim that `Payment.currency` already
   existed was checked and found **false**, only `Budget.currency` existed).
   Price displays now read `ev.currency || "OMR"` instead of hardcoding
   `"OMR"`. Display-only — no FX conversion logic anywhere, amounts stored
   are unaffected.
5. Marketing-link (UTM) UI and campaign-send tracking — **verified already
   built** (`MarketingHub.tsx`'s `UtmLinksSection`), not rebuilt.
6. Campaign ROI rollup — **not attempted this pass** (see Outstanding below);
   the underlying `EmailCampaignSend` data has no click/open tracking, only
   `recipientCount`/`sentAt`, so any "ROI" would be a labeled estimate at
   best — flagged as a follow-up, not shipped.

**Schema migrations — already applied to production.** Three additive-only
migrations (`ADD COLUMN ... DEFAULT`, no drops/renames — `Booking.seatIds`,
`Event.checkoutFormFields` + `Booking.customFieldValues`, `Event.currency`)
were generated, confirmed with the user, and run against the live prod DB
(the only `DATABASE_URL` this repo has — see §weyn-prod-ops memory). **Note
for next session:** the pooled connection string in `.env`
(`...pooler.supabase.com:6543...?pgbouncer=true`) hangs indefinitely against
Prisma's migration engine — `prisma migrate deploy` needs the *direct*
connection (swap port `6543`→`5432`, strip `pgbouncer=true`) or it will sit
with zero output forever. `prisma generate`/normal app runtime queries are
fine on the pooled URL; only the migration engine has this problem. This same
run also picked up one older pending migration (`venue_team_members`) that
had never been applied before — it's applied now too.

### Outstanding / not done — pick up here

- **UI spacing/polish pass — PARTIALLY COMPLETE (Discover only).** The user
  asked to "fix spacing in the UI and more" in the same request as the
  feature-gap work. §35 shipped Discover-specific spacing/alignment fixes
  (`d08fb69`–`cdaf814`): avatar CSS bug, category grid refinements, and
  horizontal-gutter alignment (all 3 now use 16px). **Still outstanding:**
  the full spacing/8pt-grid audit over EventDetail, Search, Map, Concierge,
  Account/You, Tickets (§35 only touched Discover); restrained purple accent
  touches extending the existing purple glow motif (District/Zomato-style
  single-accent-on-neutral), not a new color; and the profile/account entry
  point move from bottom tab bar to a small top bar showing the user's real
  profile picture (or initials avatar from `WhosGoing.tsx` pattern, if no
  photo). Bottom tab bar otherwise unchanged — the user explicitly declined
  moving the whole nav to the top. These three items (EventDetail+Search+Map
  +Concierge+Account/You+Tickets spacing, purple touches, profile top bar)
  remain to be picked up in a follow-up pass.
- **Dashboard polish pass — requested, not started.** Organizer + Venue
  ("Venue OS") dashboards need a design/UX polish pass — no scope defined
  yet beyond "polish." Before starting: check `FEATURES.md` for what's
  already built, and do a quick visual audit of both dashboards' routes
  (Overview, Events, Attendees, Marketing, Workflows, AI Studio, Settings on
  the organizer side; Reservations, Floor Plan, Guest CRM, Analytics on the
  venue side) to find concrete issues before generating a task list, same
  approach as the consumer-app spacing pass above.
- **Friend-adding system — requested, not started.** The Friends page and
  Who's Going attendee list already exist (`b0c8ef1`, this week) using the
  existing user→organizer `Follow` Prisma model per `FEATURES.md`. What's
  missing: an actual way to *add* a friend as a peer (not follow an
  organizer) — search, send/accept a friend request, a pending-requests
  inbox. Check whether `Follow` can reasonably represent symmetric
  friendship (e.g. two one-directional follows both existing = "friends"),
  or whether a real schema change (a `FriendRequest` model with
  pending/accepted/declined state) is the honest way to build this — don't
  fake a friend-request flow on top of a model that doesn't support it.
- **Profiles — requested, not started.** Scope not yet defined beyond
  "profiles" — likely the buyer/attendee-facing personal profile (separate
  from `OrganizerProfile`, which already exists) covering the brief's
  "Personal Profile" section (§ Outstanding below): upcoming/past tickets,
  saved events, followers/following, interests, reviews, photos. Needs a
  scoping pass before building — check what `Account`/`src/store.ts`
  already captures vs. what a real profile page would need to add.
- **Campaign ROI rollup** (District/Platinumlist gap #4 above) — not
  attempted; needs either real click/open tracking added to
  `EmailCampaignSend` first, or an explicitly-labeled estimate view built
  on the sparse data that exists (`recipientCount`+`sentAt`+matching
  bookings by `utmCampaign`/timing) — don't present it as precise ROI.
- **Home feed regression** (§34.1 above) — deferred at user's request, not
  forgotten. Needs real always-populated sections, not empty-state handling
  alone, before it's safe to re-land.
- **Group booking/split payments, event chat/comments, stories/post-event
  photos** (Social Features brief section) — none of these have a backing
  data model. Each needs its own schema migration + real scoping
  conversation before a build attempt; don't fake any of them with
  client-only state.
- **Older, still-pending item from a prior session** (unrelated to this
  pass): a cleanup on an earlier RBAC/publish/payments council run —
  verify the event-publish timezone fix end-to-end against a real test
  event, downgrade `hardFail`'s Sentry logging to non-error level (routine
  validation rejections shouldn't page anyone), decide finish-or-revert on
  the half-shipped `VenueTeamMember` RBAC UI (the migration is applied per
  §34 above, but no Team UI was ever built on top of it), and replace the
  tautological PayTabs idempotency test (it re-implements the logic instead
  of testing the real function) with one that exercises the actual closure.
- **Remaining brief sections never started this pass**: Personal Profile,
  Tickets (deeper — Apple/Google Wallet, transfer, gift, PDF download, seat
  selection is now real but the rest of the brief's ticket-section list
  isn't), Notifications (price drops/selling-fast/etc. beyond what
  OneSignal §33 already covers), Organizer/Venue dashboard extensions
  beyond what FEATURES.md found already built, Settings/Trust & Safety/
  Gamification (streaks/badges/loyalty — `VenueLoyalty` exists per
  FEATURES.md but no consumer-facing gamification UI does).

## 35. Discover header/spacing iteration (2026-07-18, direct-feedback pass)

Fast, no-council, direct-edit fixes on top of §34's work, done live against
user screenshots/feedback rather than a planned pass — reflects a few
back-and-forth corrections, not a single clean design decision, so read the
whole sequence before assuming any one commit is the final state.

1. `d08fb69` — **real bug fix**: `.page-top-bar-avatar` had zero CSS, so the
   profile `<img>` rendered at its native uploaded-photo resolution (easily
   1000px+) instead of as a small avatar, covering the whole screen.
   Constrained to a 32px circle, `object-fit: cover`.
2. `f119867` — first attempt at matching a District (Zomato)-style
   reference screenshot: category grid 3-col small icons → 2-col large
   tiles (84px icons), plus a bookmark icon in the top bar. **Reverted next
   commit** — the 2-column/84px version looked worse in practice than the
   original, and the user didn't want a separate top bar at all.
3. `8f9d0e1` — corrections per direct feedback: category grid back to the
   original 3-column/52px layout; removed the standalone `PageTopBar` usage
   from `Discover.tsx` entirely (component still exists, still used by
   `Tickets.tsx`/`You.tsx` — just not Discover) — the profile avatar now
   sits inline in the existing `discover-head` row (next to "Ask our
   AI"/"Host") instead of its own sticky strip; spotlight carousel slide
   width tightened 86%→78% so neighboring cards peek more visibly on both
   edges.
4. `cdaf814` — **real bug fix**: `.search` used a 12px side margin,
   `.discover-head` used 16px padding, `.cat-circles` used 20px padding —
   three different horizontal gutters stacked vertically on the same
   screen, so the search bar's edges didn't line up with the row above or
   the category grid below. Aligned all three to 16px (`--space-4`).

**Net state as of `cdaf814`**: Discover's category grid is back to its
pre-§34 3-column/52px look (not the reference screenshot's 2-column large
tiles — that was explicitly rejected). Profile avatar lives inline in the
existing header row, no separate top bar. A city/area location picker (the
reference's "Sector 79, Gurugram") was **not** built — Weyn has no
city/area-selection data model, and faking one wasn't in scope. If revisited,
scope a real location feature first rather than a decorative dropdown.
