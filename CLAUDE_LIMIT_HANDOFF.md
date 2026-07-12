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
1. [ ] Swap `src/index.css` root color tokens to the new coral palette (light + dark), preserving existing variable names.
2. [ ] Swap typography to Plus Jakarta Sans (Google Fonts import in `index.html`; replace the `--t-*` font-family references in `src/index.css`). Headings 700–800 weight, tight tracking (-0.02em); body 500 weight.
3. [ ] Re-check the skeuomorphic details the README calls out — some already exist from earlier passes this session, verify they match this spec:
   - Theme toggle as a physical sliding pill switch (glossy thumb, inset track) — `src/components/ThemeToggle.tsx`.
   - Primary/CTA buttons: vertical gradient (accent → accentDark), inset top highlight, soft shadow; press = translateY(1px) + reduced shadow. Current repo's `.btn` (in `src/index.css`) is a flatter 3D-edge style from an earlier pass — needs revisiting to match this gradient+glossy spec.
   - Ticket wallet stub: dot-grain texture, dashed perforation line with circular notches (already exists — verify colors match new palette).
   - QR panel: white sticker card, soft shadow, diagonal glossy highlight (`mix-blend-mode: soft-light`).
   - Price slider (search filters): grooved/inset track, glossy round thumb.
4. [ ] Verify all 4 screens against the reference screenshots at desktop and mobile widths, light and dark: Discovery feed (`src/pages/Discover.tsx`/`Explore.tsx`), Event detail (`src/pages/EventDetail.tsx`), Search & filters, Ticket wallet (`src/pages/Tickets.tsx`).
5. [ ] Typecheck (`npx tsc --noEmit -p .`), build (`npm run build`), then deploy (`npx vercel deploy --prod --yes`) once satisfied.

### Known outstanding items from earlier in this session (separate from the design-reference work)
- Continue the interface-design-skill review pass on remaining organizer/venue dashboard tabs (Calendar, Tables, Guests, Marketing, Workflows, Analytics) — nav active-state bug and button-hierarchy fixes already applied to the Reservations tab + AI Studio approvals; the same pattern is likely present elsewhere.
- A separate background session was spawned earlier to fix EventDetail's desktop-width layout rendering blank — check `git log` / that session for whether it landed.
- Task #43 (pending, not started): evaluate + execute Neon → Supabase migration.
