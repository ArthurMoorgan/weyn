# Handoff — Weyn design implementation (in progress)

Written 2026-07-12, before implementing the attached design reference, in case the Claude session/usage limit is hit mid-task.

(Note: this repo already has a large pre-existing `HANDOFF.md` from earlier engineering work — this is a separate, narrowly-scoped file just for the current design task and what to do if the session gets cut off.)

## What to do if Claude's limit hits mid-session

1. **Don't panic about lost work.** Everything already committed to git on `main` is safe. Check what's committed vs. still-dirty:
   ```
   cd ~/Documents/weyn-recovered/dhairya
   git status --short
   git log --oneline -10
   ```
2. **If there are uncommitted changes** you like, commit them (or ask the next Claude session to) before doing anything else:
   ```
   git add -A -- src public index.html
   git commit -m "wip: design implementation checkpoint"
   ```
3. **To deploy what's committed** (deploys here are manual, NOT automatic on push):
   ```
   cd ~/Documents/weyn-recovered/dhairya
   npm run build          # sanity check it compiles
   npx vercel deploy --prod --yes
   ```
   This aliases straight to weynevents.com.
4. **Starting a new Claude session**: point it at this file and the design reference at `/tmp/weyn-design-ref/design_handoff_ticketing_app/` (re-unzip from `~/Downloads/Weyn ticketing app design.zip` if that temp folder is gone — `/tmp` can be cleared on reboot). Tell it to read both before touching code.
5. **Claude limits reset on a timer** (shown in the error message, e.g. "resets 3:20am") — wait it out if you can, or a fresh session/account can pick this up cold using this file.

## What's being implemented right now

The user provided `Weyn ticketing app design.zip` — a high-fidelity design handoff (README + HTML reference + screenshots) for the **attendee-facing app**, and asked to implement it exactly as shown, replacing the current in-repo palette.

### Source of truth
- `design_handoff_ticketing_app/README.md` — the real spec: exact color tokens (light + dark), typography (Plus Jakarta Sans), skeuomorphic component details, layout patterns, screen-by-screen breakdown.
- `design_handoff_ticketing_app/screenshots/*.png` — visual reference, 5 screens × light/dark: Discovery feed, Event detail, Search & filters, Ticket wallet, Mobile discovery feed.
- `design_handoff_ticketing_app/Weyn Organizer Dashboard.dc.html` — NOT the priority. Contains 3 unresolved organizer-dashboard visual directions (1A Obsidian, 1B Porcelain, 1C Atlas); the README explicitly says these were never narrowed down — treat as early concepts only. **Do not implement these unless the user explicitly asks.** Focus on the attendee app spec, which the README calls "the primary, most-finished part."

### Key decision already made by the user
Move away from the amber/khanjar-terracotta palette (tried and rejected across several iterations earlier this session) back to **the original Airbnb-style coral** — which this new reference also independently specifies, almost exactly:
- Light accent: `#E1483D` (coral), pressed/gradient-dark `#C93A30`, ink-on-accent `#FFFFFF`, soft tint `#FDEDEB`
- Dark accent: `#FF6B5B`, dark-state `#E1483D`, ink-on-accent `#1C1B1A`, soft tint `rgba(255,107,91,.16)`
- Full token list is in the README's "Color tokens" section — map into `src/index.css`'s `:root` / `:root[data-theme="light"]` blocks, **keeping the existing variable names** already used throughout the codebase (`--bg`, `--surface`, `--primary`/`--accent`, `--on-primary`, `--card-bg`, etc.) so the ~300 existing call sites don't need touching — just remap hex values by role: `--panel`→`--card-bg`/`--surface`, `--accent`→`--primary`, `--accentInk`→`--on-primary`, `--accentSoft`→`--accent-soft`, `--good`→`--success`.

### Explicit non-goals for this pass
- Keep OMR / Muscat as the real currency and city — the reference uses AED/Dubai only as realistic placeholder copy, per its own README ("replace with real event data").
- Don't bring back the reference's logo/wordmark image assets (`assets/weyn-*.png`, indigo mark) — the README says the final attendee direction deliberately uses a plain-text wordmark, no logo mark. Current repo already does this.
- Don't implement the 3 organizer-dashboard concepts (1A/1B/1C) — explicitly out of scope per the README itself.

### Concrete implementation checklist (work through in order)
1. [x] Swap `src/index.css` root color tokens to the new coral palette (light + dark), preserving existing variable names. **Done** — `--primary: #E1483D` light / `#FF6B5B` dark, true white/near-black neutrals, matches the handoff exactly. Verified live in both themes.
2. [x] Swap typography to Plus Jakarta Sans. **Done** — Google Fonts import updated, `--t-*` tokens use it throughout, headings 700–800/tight tracking, body 500 weight.
3. [x] Skeuomorphic details:
   - [x] Theme toggle rebuilt as a real sliding pill switch (glossy thumb, inset track, crossfading sun/moon) — `src/components/ThemeToggle.tsx` + CSS in `src/index.css`.
   - [x] `.btn` rebuilt with vertical gradient (primary → primary-pressed), inset top highlight, soft shadow, 1px press instead of the old 3D-edge push.
   - [x] Ticket stub — perforation/notches already existed, colors now match new coral palette.
   - [x] QR panel — added `.qr-sticker` with diagonal soft-light glossy highlight (`src/components/TicketSheet.tsx` + CSS).
   - [x] Price slider — added to the filter sheet in `src/pages/Explore.tsx` (was completely missing before), grooved track + glossy thumb, actually filters the event list by price now.
4. [x] Verified Discovery feed, Event detail (desktop 2-col + mobile), Ticket wallet against reference screenshots in both themes — all match closely now.
5. [x] Search bar redesigned: was 3 absolutely-positioned icons at hand-tuned offsets (the actual misalignment bug) → real flexbox row, fully pill-shaped, grooved inset shadow. Same bare-icon sizing bug fixed in Reservations' venue search too.
6. [x] Event-card taps now use React Router's native `viewTransition` prop + custom CSS (`::view-transition-old/new(root)`) for a blur+white-wash crossfade into Event Detail, per the user's explicit ask. Confirmed `document.startViewTransition` is supported and firing in the test browser.
7. [x] **Venue/Event workspace navigation redesigned** — both `VenueWorkspace.tsx` and `EventWorkspace.tsx` previously rendered their section tabs as a plain wrapping pill row (2-3 uneven rows on mobile, same wrapped mess on desktop since neither used the sidebar layout `OrganizerLayout.tsx` already had). Both now share `.organizer-shell`/`.organizer-nav` — sticky sidebar at 900px+, single horizontally-scrolling row on mobile. Verified at 375px and 1280px.
8. [x] Typecheck/build clean at every step; deployed to production after each batch (`npx vercel deploy --prod --yes`).

### Still open / worth another pass
- A `computer` scroll-gesture tool action hung/timed-out once on the Discover page during QA (direct `body.scrollTop` JS manipulation worked instantly and rendered correctly with no overlap at the scrolled position) — inconclusive whether this is a real page bug or a testing-tool artifact with this app's "body is the scroll container" pattern. Worth a real-device check if the user still sees scroll issues.
- Only spot-checked Venue → Reservations tab's nav fix live; the same nav pattern was applied to Organizer's per-event workspace (`EventWorkspace.tsx`) but wasn't re-verified live since this test account has no organizer events (only venues) — check it renders correctly once there's a real organizer event to open.
- Haven't done a tab-by-tab QA pass of the other venue-os sections (Calendar, Tables, Guests, Marketing, Workflows, Analytics, Hours) or organizer sections (Attendees, Marketing, Seating, Team, Check-in, Settings) against the interface-design skill's checks (hierarchy, button variants, spacing) — only Reservations + AI Studio approvals got that treatment so far.
- Task #43 (pending, not started): evaluate + execute Neon → Supabase migration.
- The 3 organizer-dashboard visual concepts (1A/1B/1C) in the design zip remain explicitly out of scope per the zip's own README.
