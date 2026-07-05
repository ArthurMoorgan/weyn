# Weyn — Handoff / Continuation Guide
*Last updated: 2026-07-05, end of session (user hitting Claude usage limit, switching accounts).*

Read this whole file before touching anything. This project has been through
a LOT since the original recovery (§0 below is now historical) — it's a real
production app on Postgres/Vercel now, not the JSON-file demo described in
old versions of this doc.

## 🔴 URGENT — do these two things first, in order

### 1. Push 13 unpushed commits
My git credentials in this session lack GitHub's `workflow` OAuth scope, so
every push including a `.github/workflows/*.yml` file was rejected. Nothing
is lost — everything is committed locally — but **none of it is on GitHub
yet**. From your own machine/account with normal git access:
```bash
cd ~/Documents/weyn-recovered/dhairya   # or wherever this repo lives now
git status              # should be clean
git log --oneline -15   # confirm you see the commits listed below
git push origin main
```
Commits waiting (newest first): color palette + profile tabs, CSS brace-bug
fix, Explore discovery redesign, icon-orphan fix, type system, Lucide icon
swap, disable Weyn Ticketing, security pen-test fixes, CI pipeline, trust &
safety moderation pipeline, nightly DB backup workflow, organizer profiles +
share + calendar + error boundary.

### 2. Add the GitHub Actions secret for the nightly backup to actually run
Repo → Settings → Secrets and variables → Actions → New repository secret →
name `DATABASE_URL`, value from `.env`. Without this the backup workflow
fails loudly (by design) instead of silently skipping. Test it immediately:
Actions tab → "Nightly database backup" → Run workflow.

---

## 1. What Weyn is now

A real, deployed Muscat/Oman events-discovery and ticketing platform.
Google Sign-In auth, Postgres (Neon) via Prisma, deployed on Vercel at
**weynevents.com**. Organizers publish events (free/RSVP/external-link/
cash-at-door — **Weyn's own card ticketing is currently disabled**, see §4),
attendees discover via a redesigned Explore feed, follow organizers, save
events into collections, and get QR-ticket check-in at the door. There's a
full admin dashboard, an AI-powered trust & safety moderation pipeline, and
this session did a from-scratch visual redesign (new icon system, type
scale, color palette, card system, discovery-based Explore).

## 2. Architecture at a glance (current, not the old JSON-file version)

```
dhairya/
├── src/                      React 18 + TypeScript + Vite
│   ├── api.ts                 typed fetch client
│   ├── store.ts                localStorage: saved, tickets, theme, account
│   ├── ics.ts                  client-side .ics calendar file generator
│   ├── lucide.css              self-hosted Lucide icon webfont (NOT Tabler anymore)
│   ├── components/              Stub (3-density event card), MapPicker, FollowButton,
│   │                            ErrorBoundary, GoogleLoginButton, ThemeToggle, etc.
│   └── pages/
│       ├── Explore.tsx          discovery feed: Featured/Tonight/Weekend/Popular/
│       │                        category rails + dense "All upcoming" list
│       ├── EventDetail.tsx      two-column on desktop, share/calendar/follow buttons
│       ├── You.tsx              NOW TABBED: Overview/Tickets/Saved/Lists/Organizer/Settings
│       ├── OrganizerProfile.tsx public organizer page (follow destination)
│       ├── Admin.tsx            platform metrics + trust & safety review queue
│       ├── Collection.tsx, Saved.tsx, Organizer.tsx (host form), InviteAccept.tsx
├── server/                   Express — real backend, not mocked
│   ├── app.js                   ~50 REST routes, rate-limited, auth-gated
│   ├── db.js                    Prisma-backed data layer (NOT a JSON file anymore)
│   ├── auth.js                  JWT sessions (HS256 pinned) + event-ownership middleware
│   ├── moderation.js             trust & safety: rule engine + AI scoring pipeline
│   ├── payments.js               PayTabs integration (correct, but not configured — see §4)
│   ├── email.js                  Resend (team invite emails) — configured, working
│   ├── monitoring.js             Sentry + PostHog — Sentry DSN is set and live
│   └── moderation.test.js        first test file in the repo (13 tests, node:test)
├── prisma/schema.prisma       Postgres (Neon) schema — Event/User/Booking/Ticket/
│                              Follow/Collection/Report/ModerationResult/etc.
├── .github/workflows/
│   ├── backup-db.yml            nightly pg_dump → 90-day GitHub artifact (needs secret, see §0.2)
│   └── ci.yml                    typecheck + build + test on every push
└── HANDOFF.md                 this file
```

## 3. How to run it locally
```bash
npm install
npm run dev          # backend :4000 + Vite :5173 together (needs .env — already populated)
npm run build         # tsc -b && vite build
npm test               # node --test server/*.test.js
```
`.env` already has real credentials: `DATABASE_URL` (Neon Postgres),
`CLERK_SECRET_KEY`/`VITE_CLERK_PUBLISHABLE_KEY`, `PUBLIC_APP_URL`,
`CRON_SECRET`, `VITE_GOOGLE_MAPS_KEY`, `GROQ_API_KEY` (powers AI moderation
and Instagram import), `RESEND_API_KEY`, `SENTRY_DSN`. **`PAYTABS_PROFILE_ID`/
`PAYTABS_SERVER_KEY` are NOT set** — this is intentional right now (§4).

## 4. Weyn Ticketing is deliberately disabled

Per explicit user request: card payments through Weyn aren't live, so the
"Weyn Ticketing" option is greyed out in the host form (with a "Coming
soon" disclaimer) AND rejected server-side in `POST /api/events` (returns
400 `TICKETING_DISABLED` if someone tries to bypass the UI via the API
directly). **Do not silently re-enable this** — only do it once the user
provides real PayTabs credentials and explicitly asks. To re-enable: remove
`disabled: true` from the "weyn" entry in `TICKETING_OPTIONS`
(`src/pages/Organizer.tsx`), and restore `"weyn"` to the two allowlists in
`server/app.js` (`POST /api/events` and `PATCH /api/events/:id`).

## 5. This session's work: full visual redesign

The user asked for a "critical product design refactor" — NOT a cosmetic
pass, referencing Airbnb/Eventbrite/Spotify/Linear/Notion/Stripe. Before
starting, a full backup tag was created: **`backup-pre-design-refactor-
20260705`** — `git reset --hard backup-pre-design-refactor-20260705` fully
reverts every redesign change below if something's wrong beyond quick fixing.

### Done ✅
- **Icon system**: fully migrated from Tabler (CDN) to self-hosted Lucide
  webfont (`public/fonts/lucide.woff2`, `src/lucide.css`). All ~110 icon
  references across the codebase updated. **A mid-migration bug caused
  every icon on the site to render tiny/misaligned** (orphaned CSS rules
  still targeting the old `.ti` class) — found and fixed; verified live.
- **A separate, unrelated regression**: a CSS insertion left a duplicate
  unclosed `.card {` rule, which broke EVERY rule after it in the
  stylesheet (that's why the search bar suddenly looked broken along with
  "everything else"). Fixed; braces now balanced (verified with a script —
  see §7, this should be re-run after any future large CSS edit).
- **Type system**: real Inter 700 weight now loads (was faux-bolding 600
  before — a genuine "looks AI-generated" tell). Five-role scale: Hero/
  Section/Card/Metadata/Caption, defined as CSS custom properties
  (`--t-hero`, `--t-section`, etc. in `src/index.css`).
- **New color palette**: dark mode warmed/richened slightly; **light mode
  completely replaced with a cream palette** (`#F6F1E7` bg, warm off-white
  cards, warm near-black text) because the user said the old stark-white
  light mode "hurts my eyes." Do NOT revert to pure white/black without
  being asked.
- **Explore page rebuilt around discovery** (the user's explicitly named
  "weakest page"): Featured hero rail, Happening Tonight, This Weekend,
  Popular Near You, per-category rails, dense "All upcoming" list — instead
  of one flat vertical feed of identical giant cards.
- **New 3-density card system** (`src/components/Stub.tsx`): `list` (dense
  Airbnb-search-style row, ~92px tall), `rail` (compact vertical, for
  horizontal scroll sections), `feature` (large hero card). Replaces the
  old single giant image-dominant card everywhere.
- **Profile split into tabs**: `You.tsx` was one long stacked page; now has
  a real tab bar — Overview / Tickets / Saved / Lists / Organizer /
  Settings. Lists/Organizer tabs only show once relevant (signed in /
  hosting an event) so new users don't see empty tabs.
- **Motion (partial)**: skeleton loaders (row-shaped, matching the new
  card), card hover-lift, rail-image raise on hover, live-badge pulse
  animation, focus rings.
- **Desktop (partial, pre-existing + minor additions)**: sidebar nav,
  2-column dense grid for lists, wider rail/feature cards on desktop.

### NOT done — genuinely remaining from the original design-refactor prompt
1. **Desktop-specific layouts for other pages.** Explore/You got desktop
   treatment; **Event Detail, the Host/create-event form, and Admin are
   still just the mobile layout stretched wide** — no dedicated desktop
   grid/sidebar/table treatment. The prompt's test ("why is this better on
   desktop than mobile?") isn't satisfied for these yet.
2. **Optimistic UI updates.** Follow/save/RSVP still wait for the server
   response before updating — no instant-then-reconcile pattern anywhere.
3. **Animated search suggestions.** The Explore search box is a plain
   input with no live-suggestion/autocomplete UI.
4. **Richer transitions/micro-interactions.** Sheet open/close (the
   Edit/Team/Analytics/etc. modals in You.tsx) still just appear/disappear;
   no slide/fade transition. Button press feedback is minimal.
5. **Visual QA pass with actual eyes.** See §6 — I was building blind for
   most of this session (no working screenshot tool). The user caught one
   real regression (§5 "separate, unrelated regression" above) this way.
   **A careful pass looking at every page in both light and dark mode,
   mobile and desktop widths, is overdue** and should happen before trusting
   this redesign is actually "done."

## 6. ⚠️ Tooling problem: screenshot/preview tools were broken all session

Both the built-in preview tool (`preview_start`/`preview_screenshot`) and
the Chrome browser-automation tool failed every single time they were
attempted this session (preview: reports "started" then immediately "not
found"; Chrome tool: "extension not connected"). **If you're a fresh Claude
session, try these again first** — they may just work now, and if so, USE
THEM. A large fraction of the friction and one real bug this session came
from making CSS/layout changes with zero visual feedback, verified only by
`tsc`/`vite build` (which catch syntax errors, not "does this look right").

If CSS tools are working for you: do the visual QA pass from §5 item 5
before anything else.

## 7. Guardrail to keep: CSS brace-balance check

Because one unbalanced `{`/`}` silently breaks everything after it in a
stylesheet (and there's no visual feedback to catch it), run this after
ANY non-trivial edit to `src/index.css`:
```bash
node -e 'const fs=require("fs");let d=0;for(const c of fs.readFileSync("src/index.css","utf8")){if(c==="{")d++;else if(c==="}")d--;}console.log("depth:",d)'
```
Must print `depth: 0`. This is now a standing habit, not optional.

## 8. Other known-good, don't re-litigate

- **Security**: a full pen-test pass was done this session — found and
  fixed a real HIGH-severity bug (paid events were bookable for FREE via
  the free-booking endpoint when PayTabs wasn't configured), locked down
  an open push-notification test endpoint, capped booking quantity, added
  rate limits on reports/follow/collections, pinned JWT algorithm. See git
  log commit "Security: close free-paid-ticket hole..." for full detail.
- **Trust & safety**: an MVP AI moderation pipeline exists
  (`server/moderation.js`) — rule engine + LLM scoring, gates DISCOVERY
  VISIBILITY only, never event creation. Tuned per user request so
  low-quality-but-honest events are NOT held back (only real fraud/spam
  triggers review/blocking) — don't re-tighten this without being asked,
  it was a deliberate growth-priority decision.
- **CI**: `.github/workflows/ci.yml` runs typecheck+build+test on every
  push (once pushed — see §0.1). Not yet a merge-blocking gate, just visible.
- **Backups**: nightly Postgres dump via GitHub Actions (needs the secret,
  §0.2). Neon free tier only has ~24h point-in-time recovery on its own.
- **CodeRabbit CLI** is installed (`~/.local/bin/coderabbit`) but the user
  never ran `coderabbit auth login` — offer to help with that if relevant.

## 9. Backlog / lower priority (not touched recently, still real)

- Task #10 (old numbering): never actually verified end-to-end with live
  PayTabs sandbox keys — moot until §4 is revisited.
- Task #29: Render.com deploy guide — the project moved to Vercel, this is
  stale, probably fine to close.
- Full accessibility sweep (an earlier audit found very few aria-labels
  across the frontend) — not addressed this session.
- Code-splitting the frontend bundle — `vite build` warns the main chunk is
  >500kB; not urgent, but a real optimization opportunity if load time ever
  becomes a complaint.

## 10. If you're a fresh Claude picking this up

1. Read this file fully (you just did).
2. Try the preview/screenshot tools — if they work now, use them for
   everything visual instead of building blind.
3. Push the 13 commits (§0.1) if the user hasn't already from their side.
4. Ask the user what they want next: finishing the design-refactor
   remainder (§5 "NOT done" list), or something else entirely. Don't
   assume — the user's priorities shift session to session.
