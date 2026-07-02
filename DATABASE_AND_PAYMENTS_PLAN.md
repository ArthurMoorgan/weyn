# Weyn: Real Database + Payment Portal — Implementation Plan

**Status: NOT YET BUILT.** This is a handoff plan for whoever (which Claude
session) picks this up next. `npm install prisma @prisma/client` and
`npx prisma init` have already been run (see `prisma/schema.prisma`,
`prisma.config.ts` — currently just Prisma's default scaffold, no real schema
yet). Nothing else has been touched. Read this whole file before writing code.

## Why this is needed

Weyn currently "persists" everything in a single JSON file
(`server/db.js` → `server/data.json`) and has no real payment collection —
booking a paid ticket just increments a `sold` counter with no money changing
hands. That's fine for a demo, but breaks the moment two people book
concurrently (file writes aren't atomic/transactional) or an organizer wants
to actually charge for a ticket.

This plan does two things, landed together since payments need somewhere
durable to record transactions:

1. **Replace the JSON file with a real Postgres database** (Neon free tier —
   permanent free tier, no 90-day expiry like Render's free Postgres — via
   Prisma ORM).
2. **Wire up Thawani Pay** (Oman's local payment gateway — picked because
   Stripe doesn't support Omani merchants directly) so paid tickets actually
   charge a card and only confirm the booking once payment succeeds.

Free events (`price: 0` / RSVP) are untouched — they never touch the payment
gateway, only paid `ticketingType: "weyn"` tickets do.

## ⚠️ Credentials the user must provide before this can be finished

Neither of these can be fabricated or signed up for on the user's behalf —
**ask the user for these before attempting to run/test anything real**:

1. **`DATABASE_URL`** — a Postgres connection string from
   [neon.tech](https://neon.tech) (free tier, no credit card, no expiry).
   Sign up → create a project → copy the connection string it gives you
   (looks like `postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require`).
2. **Thawani Pay API keys** — sign up at [thawani.om](https://thawani.om) for
   a merchant account (or their sandbox/UAT environment for testing first).
   Need: `THAWANI_SECRET_KEY`, `THAWANI_PUBLISHABLE_KEY`. Start in **sandbox
   mode** (`uatcheckout.thawani.om`) with their test cards before switching to
   production keys — standard practice, means no real money moves during
   development.

**Before implementing Part 2 (payments), fetch Thawani's current API docs**
(WebFetch or ask the user for the docs link) to confirm the exact checkout
session creation endpoint, request/response shape, and webhook signature
verification mechanism — APIs change, don't assume the shape described below
is still exactly correct at build time.

## Part 1 — Database: JSON file → Postgres (Neon + Prisma)

**Why Neon + Prisma:** Neon's free tier has no expiry (unlike Render's free
Postgres, which pauses after 90 days) — appropriate since this is becoming a
real app, not a demo. Prisma gives schema migrations and a clean query API,
which matters since the user is new to backend work and Prisma's errors are
far more readable than raw SQL mistakes.

**Schema** (`prisma/schema.prisma`), modeled directly on the current JSON
shape in `server/db.js` (read that file first — the seed data at lines 43-133
shows every field an `Event` currently has):

- `Event` — mirrors the existing event fields (title, organizer, cat,
  startsAt, endsAt, venue, area, lat, lng, distanceKm, price, capacity, sold,
  image, color, glyph, blurb, tags, refundPolicy, minAge, cancelled,
  ticketingType, externalTicketUrl, organizerContact, sourceUrl,
  importedFromInstagram)
- `Tier` — one row per ticket tier, FK to `Event` (`id, eventId, name, price,
  capacity, sold`) — replaces the `tiers` JSON array added for multi-tier
  tickets (see `src/api.ts`'s `Tier` interface and `server/index.js`'s tier
  handling in the `POST /api/events` and `POST /api/events/:id/book` routes)
- `Booking` — FK to `Event` and optionally `Tier`; adds `status` (`pending`,
  `paid`, `cancelled`, `expired`) and `deviceId`/`email`/`name`/`bookedAt`/
  `reminded` (same fields as today's `data.bookings` in `db.js`)
- `Payment` — one row per Thawani checkout session: `bookingId`,
  `thawaniSessionId`, `amount`, `status`, raw webhook payload (JSON column)
  for audit/debugging
- `PushToken`, `MarketingAsset` — same shape as today's JSON arrays, just
  tables instead

**Rewriting `server/db.js`:** Keep the exact same exported function names
(`all`, `get`, `insert`, `update`, `addBooking`, `attendeesForEvent`,
`upsertPushToken`, `tokenForDevice`, `duePendingReminders`, `markReminded`,
`getMarketing`, `setMarketing`, `reseed`) — this module was deliberately built
as a swappable interface for exactly this migration. The only breaking
change: every function becomes `async` (Prisma calls are promises), so every
call site in `server/index.js` needs `await` added in front of it — that's
the main mechanical work here, not new logic. Go through `server/index.js`
route by route and add `await` to every `db.*` call; the route handlers are
already `async` in most places (check each one).

**One-time migration script** (`server/migrate-json-to-db.js`): reads the
existing `server/data.json` (if it still exists locally), inserts every
event/tier/booking into Postgres preserving IDs, run once by hand before
cutover. Not needed if starting fresh with just the seed data — `db.js`'s
`seed()` function can be adapted to do an idempotent upsert on first boot
instead, whichever is simpler once you're implementing.

**Config:** add `DATABASE_URL` to `.env` / `.env.example`, and to
`render.yaml` / `fly.toml` env vars (both already exist in the repo from
earlier deployment prep — check `server/Dockerfile` too, Prisma needs its
generated client available at runtime, which usually means running
`npx prisma generate` as part of the Docker build step, not just locally).

## Part 2 — Payments: Thawani Pay

**Flow change:** today, clicking "Get ticket" on a paid event immediately
calls `POST /api/events/:id/book` (see `server/index.js`) and marks it sold
instantly — no money involved. That has to change to a real checkout
round-trip:

1. Frontend calls a new `POST /api/events/:id/checkout` (with `tierId` if the
   event has tiers — see the tier picker UI already built in
   `src/pages/EventDetail.tsx`) instead of booking directly. Free events keep
   using the existing `POST /api/events/:id/book` flow unchanged — only route
   paid `weyn`-ticketing events through checkout.
2. Backend creates a `Booking` row with `status: "pending"`, creates a
   Thawani checkout session for the ticket price (via a new
   `server/payments.js`), and returns Thawani's hosted checkout URL.
3. Frontend redirects (`window.location.href = checkoutUrl`) to Thawani's
   payment page — same pattern as Stripe Checkout, so no card form needs to
   be built in-app.
4. Thawani calls back a webhook — `POST /api/payments/webhook` — on success
   or failure. The backend verifies the request is genuinely from Thawani,
   and **only on confirmed success** does it: mark the `Booking` as `paid`,
   increment `Tier.sold` (or `Event.sold` for untiered events) inside a DB
   transaction (so a sold-out race can't double-book — use Prisma's
   `$transaction`), and send the existing push-notification confirmation
   (reuse `server/push.js`'s `sendPush`).
5. Thawani redirects the browser back to `success_url` / `cancel_url` — add
   two small new frontend routes (`/#/checkout/success`,
   `/#/checkout/cancel`, wired into `src/main.tsx`'s router) that show a
   confirmation/failure state. **The webhook, not the redirect, is the source
   of truth** for whether payment actually succeeded, since the browser
   redirect can be interrupted (closed tab, network drop) — the success page
   should just poll `GET /api/bookings/:id` a few times to check the status
   Prisma/webhook already set, not assume success from the redirect alone.

**New file `server/payments.js`:**
- `createCheckoutSession(booking, event, tier)` — calls Thawani's checkout
  API with the ticket price, `client_reference_id` = the booking id, and the
  success/cancel URLs; returns the hosted checkout URL. Confirm the exact
  request shape against Thawani's current docs before writing this — general
  shape (from public info at time of writing, verify before use): POST to
  their checkout-session endpoint with a `products` array
  (`{name, quantity, unit_amount}` — note Thawani amounts are typically in
  baisa, i.e. OMR × 1000, confirm this), `success_url`, `cancel_url`,
  `metadata`; response includes a `session_id` used to build the redirect URL
  with the publishable key.
- `verifyWebhook(req)` — validates the incoming webhook is genuinely from
  Thawani before trusting it (exact signature/secret mechanism — confirm
  against their current docs, this is the single most important thing to get
  right since skipping verification means anyone could fake a "payment
  succeeded" webhook and get free tickets).

**Config:** `THAWANI_SECRET_KEY` (server-only, used to create sessions),
`THAWANI_PUBLISHABLE_KEY` (safe to expose client-side), `THAWANI_API_BASE`
(sandbox `uatcheckout.thawani.om` vs production `checkout.thawani.om`).

**Stale pending bookings:** if someone opens checkout and abandons it, their
`Booking` stays `pending` forever otherwise, silently holding a slot. Add a
small cleanup: bookings `pending` for more than ~30 minutes get treated as
`expired` and excluded from capacity counts (checked lazily on next capacity
check is enough for an MVP this size — no cron needed).

## Files this touches (for reference)

- `server/db.js` — full rewrite, Prisma-backed, same function signatures
- `server/index.js` — add `await` to all `db.*` calls; add checkout + webhook
  routes; existing routes to study: `POST /api/events/:id/book` (current
  instant-booking logic to branch off of), the tier-handling code added for
  multi-tier tickets
- `server/payments.js` — new
- `server/migrate-json-to-db.js` — new, one-time use
- `prisma/schema.prisma` — currently just scaffold, needs the real schema
  described above
- `src/api.ts` — add `checkoutEvent()` client method, `Booking`/`Payment`
  types if the frontend needs to read booking status
- `src/pages/EventDetail.tsx` — paid-tier "Get ticket" button calls checkout
  instead of book; free/RSVP path unchanged
- `src/main.tsx` — add `/checkout/success` and `/checkout/cancel` routes
- `.env`, `.env.example`, `render.yaml`, `fly.toml`, `server/Dockerfile` —
  new env vars + Prisma generate step in the Docker build

## Verification checklist

- `npx prisma migrate dev` runs cleanly against the Neon connection string, tables created
- Migration script (if used) — event/tier/booking counts match the old `data.json`
- `npx tsc --noEmit` clean, both servers start without errors
- **Regression check**: free-event RSVP flow still books instantly with zero Thawani interaction
- Paid single-price event: book → redirected to Thawani sandbox checkout → pay with test card → webhook fires → booking flips to `paid` → ticket appears in "My Tickets"
- Paid tiered event: same flow, confirm the correct tier's stock decrements, not the whole event
- Concurrency check: fire two simultaneous checkout+webhook sequences for the last unit of stock, confirm only one succeeds (transaction correctness — this is the whole reason for moving off JSON-file storage)
- Abandoned checkout: confirm it doesn't silently count against capacity forever
- Webhook signature verification: send a fake/unsigned webhook, confirm it's rejected
