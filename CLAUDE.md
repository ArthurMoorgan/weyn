# Weyn — engineering & design guide

Weyn is a dark-first events/venues discovery + ticketing app (React + Vite,
Express + Prisma, Clerk auth). This file is loaded every session — treat the
**Design principles** below as standing requirements for every screen,
component, and interaction, not as suggestions.

## Where the design system lives

- **Tokens:** `src/styles/tokens.css` — colors, spacing, radius, shadows,
  typography ramp, per-category tile accents. Use these variables; never
  hardcode a hex, px shadow, or font size that a token already covers.
- **Base element styles:** `src/styles/base.css` (headings, body, helpers).
- **Component styles:** `src/styles/components.css`.
- **Motion primitives:** `src/motion/` — `MotionButton`, `MotionLink`,
  `MotionNavLink`, `usePressable`, `usePrefersReducedMotion`, and the shared
  springs (`pressSpring`, `settleSpring`) + variants (`pageVariants`,
  `staggerContainer/staggerChild`, `shellEntrance`). Route-level transitions
  and the card→hero `layoutId` morph run through `src/motion/RouteTransitions.tsx`.

# Design principles

Apply these consistently. They extend — and must not break — Weyn's
established **monochrome** design language (Uber/Apple direction: one neutral
grey family on off-black; hue lives in event photography and the niche-grid
tile accents, not in the chrome).

## Signifiers
- The UI must explain itself without instructions — never make the user guess
  how something works.
- Clearly indicate what is clickable, selected, disabled, or interactive.
- Every interactive element needs the full state set (see **Buttons & Inputs**).
- Route taps/links through `MotionButton` / `MotionLink` / `MotionNavLink` so
  press feedback is automatic and reduced-motion-aware. Do **not** use raw
  `<a href>` for in-app navigation — it triggers a full-page reload; use
  react-router `Link`.
- Selection must have a visible state, not just a behavior change (e.g. the
  niche grid's `.cat-circle.on` — accent border + tint + label).
- Use `Tooltip` only when a control needs extra clarification.

## Visual hierarchy
- Most important information first; primary content larger/bolder than secondary.
- Establish hierarchy with size, weight, contrast, and position — not decoration.
- Use the type ramp (`--t-hero` → `--t-section` → `--t-card` → `--t-meta` →
  `--t-caption`); don't invent new sizes.
- Use icons where they improve scannability.

## Whitespace & spacing
- Use the 4px scale exclusively: `--space-1: 4` … `--space-8: 48` (and the
  same 4-multiple sequence beyond it). No off-scale margins/paddings.
- Group related content with tighter spacing; separate unrelated content with
  larger spacing. Prioritize whitespace over dividers — Weyn separates with a
  lifted surface tone + soft shadow, **not** hard borders.

## Typography
- One family: `--f-display` (Geist). Keep the number of sizes small — reuse the
  ramp tokens.
- Large headings: tight tracking (`-0.02em` / ~-2%) and line-height ~110–120%
  (already baked into `--t-hero` at `/1.15` and the `h1/h2` rules in base.css).
- Keep hierarchy clear and consistent.

## Color
- Build from the primary "ink" (`--primary`: white in dark, black in light);
  greys ramp from `--bg` → `--surface` → `--surface-hover`.
- **Monochrome reconciliation (Weyn-specific, important):** Weyn does not use
  green/yellow in the chrome. Semantic *hue* is reserved for **error/danger
  only** (`--error`, one desaturated red). Success and warning are expressed
  through greyscale + iconography/copy, not color. Information/trust reads
  through the neutral system, not blue. Add hue only where the design language
  already allows it: event imagery and the `--tile-*` niche accents.
- Never use color purely for decoration.

## Dark mode (the default)
- Don't invert light mode. Lighter surfaces sit on darker backgrounds to build
  depth (`--surface` #191919 on `--bg` #121212).
- Keep border contrast low; carry elevation with surface tone + subtle shadow.
- Reduce saturation of any bright color; background is softened off-black
  (#121212), text stepped back from pure white — keep it that way.

## Shadows & depth
- Soft, low-opacity, high-blur (`--card-shadow`, `--shadow-sm/md/lg`,
  `--shadow-float`). If a shadow is immediately noticeable, it's too strong.
- Cards: subtle shadow. Modals/popovers/floating nav: stronger
  (`--shadow-float`).

## Icons
- Match icon size to the adjacent text's line height where appropriate.
- Use icons to speed recognition and scanning; don't add them as decoration.

## Buttons & inputs
Every interactive component must define: **default, hover, active/pressed,
focus, disabled**, and **loading** where applicable. Inputs additionally need
**error** and **success** states. Prefer the shared primitives so the
press/hover/focus feel is consistent; add explicit disabled + loading styling
(don't rely on opacity alone for loading).

## Feedback
- Every user action gets immediate visual feedback: state change, loading
  indicator, success confirmation, or animation.
- Optimistic UI where it makes the action feel instant (see `FollowButton`),
  reconciled with the server and rolled back on failure.

## Microinteractions
- Subtle, purposeful, never distracting. Reuse `pressSpring` for gesture-driven
  feedback and `settleSpring` for content settling in.
- All motion must respect `prefers-reduced-motion` — use the primitives or
  `usePrefersReducedMotion()`; never hand a literal `whileTap` scale without
  the reduced-motion guard.

## Image overlays
- Never place text directly on a busy image. Use a gradient/scrim to guarantee
  contrast (see the `--fallback-scrim` + hero card treatments).
- Prefer a progressive/soft gradient for a premium feel over a flat dark box.

---

When a requested change conflicts with the monochrome language (e.g. "make the
success state green"), flag the tension and follow the established language
unless the user explicitly overrides it.
