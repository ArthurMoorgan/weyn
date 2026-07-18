# Discover header/spotlight reference spec (District video)

Source: `~/Downloads/ScreenRecording_07-18-2026 04-24-08_1.mov` (1180×2556,
60fps, 27.1s). Measured from frames already extracted to the session
scratchpad (`frames/frame_001.png`…`frame_027.png`, downscaled to 400×866,
1fps) plus a targeted 10fps re-extraction of the two tab-switch transitions
(`hifps/seg1_*.png` t=2.0–5.0s, `seg2_*.png` t=5.0–8.5s) for glow/skeleton
timing. All measurements below are pixel offsets in the 400px-wide reference
frame (≈393pt device viewport, scale error <2%) — read with a 20px grid
overlay and confirmed with raw pixel sampling, not eyeballed. Cite this file
(`docs/discover-reference-spec.md`) in commits that implement against it.

## Header

- Search bar: y 125–170 (44px tall), x 16–384 (368px wide = 92% of
  viewport), 16px side margins, full pill radius.
- Location pill (pin + "Sector 79 ⌄" / "Gurugram"): row y ≈ 55–100 (~45px),
  left-aligned. Bookmark + avatar cluster same row, right-aligned: bookmark
  glyph ~17px in a ~36px tap target, avatar a ~37px circle.
- Gaps: location row → search bar ≈ 20–25px; search bar → tab strip/icon
  row ≈ 25–30px.
- Category tab strip (text tabs, active = bold white + underline): row
  y ≈ 202–229 (~27px incl. 3px underline). Underline color sampled
  ≈ RGB(108,74,255) ≈ `#6C4AFF`.
- Home icon grid (3-col, icon-only mode): icon glyph ~48–52px per cell,
  column pitch ≈ 127–133px across the 400px width, row pitch (row1→row2)
  ≈ 115–120px, label text ~20px below icon.

## Spotlight carousel

- Active card: x 48–352 → **304px wide = 76% of viewport**. (Matches
  HANDOFF §35's "tightened 86%→78%" note — this frame reads slightly
  tighter, 76%, treat 76–78% as the target band.)
- Left neighbor peek visible ≈ 28px (7%), right neighbor peek visible
  ≈ 32px (8%). Inter-card gap ≈ 16–20px (4–5%).
- Card height: y 292–648 → 356px. Aspect ratio width:height ≈ 0.85 (~6:7).
- Corner radius ≈ 20–24px. Bottom accent bar (offer strip, e.g. "20% OFF
  up to ₹350") ≈ 20–24px tall, full card width, flush to card bottom.
- Pagination dots directly under the card.

## Per-tab ambient glow (top wash behind location pill, retriggered on tab tap)

Sampled at the gradient's brightest point, top-center of frame:

| Tab | RGB | Hex (approx) | Hue |
|---|---|---|---|
| Dining | (121,18,42) | `#79122A` | crimson/magenta |
| Movies | (16,66,125) | `#10427D` | blue |
| Events | (109,99,24) | `#6D6318` | amber/gold |
| Stores | (14,66,31) | `#0E421F` | green |
| Activities | (107,40,23) | `#6B2817` | orange-red |
| Play | (3,94,81) | `#035E51` | teal |

Timing (10fps re-extraction, ±100ms resolution): tap → bright bloom spike
within ~100–200ms → settles to steady ambient tint by ~300–400ms → holds
~1.5–2s while the skeleton is up → fades out over ~100–200ms as content
crossfades in. Total glow-visible window per tab switch ≈ 2–2.5s.

## Skeleton (loading state)

- Visible ≈ 2.3–2.9s per tab switch before crossfading to real content;
  the crossfade itself is fast (~1–2 frames at 10fps, ~100–200ms), not a
  slow fade.
- Contrast is very subtle: background ≈ RGB(20,19,22), placeholder blocks
  ≈ RGB(26,27,30) — only ~6–8/255 lighter, not the typical light-gray
  skeleton look.
- Block layout, top to bottom:
  1. thin title-pill, ~75% width, ~24px tall, directly under the tab strip.
  2. one large hero/banner rectangle, full content width (16px margins),
     ~290–310px tall, aspect ≈ 1.2–1.4:1.
  3. a two-line text-pill (~65% width) + a separate small square badge
     (~15% width) on the same row.
  4. another thin section-title pill.
  5. a row of ~2 squarish card placeholders (more implied off the bottom
     edge of the captured frame).
