# Discover reference spec — re-analysis (glow + skeleton timing)

Audit-only follow-up to `docs/discover-reference-spec.md` (§36 of `HANDOFF.md`).
No code changed in this pass. Source video is the same file:
`~/Downloads/ScreenRecording_07-18-2026 04-24-08_1.mov`.

**Correction to the subtask brief**: this video's tab strip is District's
6-way Dining/Movies/Events/Stores/Activities/Play switcher, not an
Events/Venues toggle — Weyn has no such toggle in the source material. All
measurements below are taken from those tab switches (Dining→Movies and
Events→Stores), which is the closest analog to Weyn's Events⇄Venues switch
and is exactly what `docs/discover-reference-spec.md` and `HANDOFF.md` §36.4–5
already reference.

**Correction to native frame rate**: `ffprobe` reports the source as
**1180×2556 @ 60fps**, not 30fps. Frame-accurate measurements below were taken
at native 60fps (16.7ms/frame) over the transition windows, corroborated with
30fps and 20fps re-extractions elsewhere in the clip; ms figures are reported
directly rather than converted through a 30fps frame count.

## Method

- Pixel-sampled (not eyeballed) via `ffmpeg -vf fps=60` frame dumps + a Python/
  Pillow script averaging background-only pixels (text/icon pixels excluded by
  a brightness-sum threshold) at several y-bands in the glow region (the gap
  between the location row and search bar, y≈100–150px in the 400px reference
  frame used by the original spec).
- Measured two independent tab switches: Dining→Movies (t≈4.7–5.3s) and
  Events→Stores (t≈13–17s) for corroboration.
- Content-load timing measured separately via pixel variance (std-dev) in the
  spotlight-card region: flat/uniform pixels = skeleton placeholder, rising
  variance = real image content rendering in.

## Finding 1 — no brightness spike/bloom; it's a direct hue crossfade

Sampled at 8 different y-bands (120/150/180/220/305/350/400/450px) through the
Dining→Movies tap, at every native 60fps frame:

- Old hue (Dining) holds flat through t=4.917s.
- At t=4.933s (the very next 60fps frame, 16.7ms later) the value jumps
  **directly** to a point already close to the new steady-state hue — at
  y=305: sum 102.2 → 69.7 in one frame, no intermediate overshoot.
- It then eases (not spikes) to the final steady value over the next
  ~230–250ms (69.7 → 70.9, monotonically, never re-crossing or exceeding
  either the old or new resting value).
- At **no sampled y-band** does the new value ever exceed its own final
  resting brightness. There is no overshoot/flash at all — the keyframe
  shape the existing spec described (§36.4: "spike within 100–200ms →
  settles by 300–400ms") is not what these pixels show. What's actually
  there is a same-frame hue-swap immediately followed by a ~250ms ease to
  rest, with no brightness excursion above the rest value.
- Once settled, the glow **holds perfectly flat for the entire remainder of
  that tab's active period** — continuous flat readings from t≈5.2s through
  t≈7.7s (≈2.5s, until the very next tap), not a bounded "hold ~1.5–2s then
  fade out." There is no independent fade-out phase separate from the next
  tab's transition: the color just stays until the next tap causes the next
  instant hue-swap.

**Comparison to shipped code** (`src/styles/components.css:75-81`):
```css
.shell.ambient-pulse::before { animation: ambient-bloom 900ms ease-out; }
@keyframes ambient-bloom {
  0% { opacity: 0.55; }
  15% { opacity: 1.6; }   /* an actual overshoot spike the video doesn't have */
  40% { opacity: 1; }
  100% { opacity: 1; }
}
```
This keyframe's 0.55→1.6→1 shape is a genuine **shape** mismatch, not just an
approximate timing: the video shows no brightness spike at all. The
`.shell[data-ambient]` hue-crossfade (`--ambient-top` transition, `.5s`
cubic-bezier, `components.css:54`) is closer to what's actually happening,
and the "hold indefinitely until next switch" behavior the code already
produces (the class removal after 900ms doesn't undo the hue, which is
controlled separately by the `data-ambient` attribute) is correct — it's
specifically the bloom-pulse spike that doesn't match. This is a genuine UX
finding, not a hardware/network difference — District's glow color itself
isn't network-dependent.

## Finding 2 — skeleton hold is shorter than previously measured, still a genuine gap vs. 900ms

- Dining→Movies: flat/zero-variance skeleton placeholder appears at the tap
  (t≈4.93s), real content variance starts rising at t≈6.6s (**+1.67s**), and
  is fully steady by t≈6.8s (**+1.87s**).
- Events→Stores (second, independent sample): visibly shorter — skeleton
  from tap (~t=13.4s) to content appearing (~t=14.5s), fully settled
  ~t=15.0s, i.e. **≈1.0–1.6s**.
- These two switches bracket **≈1.0–1.9s**, not the **2.3–2.9s** the original
  spec (`docs/discover-reference-spec.md`, its own 1fps/10fps pass) reported.
  The gap is real but the earlier spec's number was itself on the high end —
  likely from a switch involving a heavier content payload, or measurement
  resolution (1fps overview + a single 10fps re-extraction) rounding up.
- Since it's plausible the two tab switches I measured hit an already-warm
  network cache partway through the recording (later switches in a session
  commonly do), the 1.0–1.9s band should be read as **at least as fast as**
  the true worst-case, not necessarily the ceiling.

**Comparison to shipped code**: `SWITCH_SKELETON_MS = 900` (`Discover.tsx:27`)
is still meaningfully shorter than even the low end of this freshly
measured range (900ms vs. ~1.0–1.9s, roughly 1.1–2.1x short, versus the
previous ~2.6–3.2x-short framing). HANDOFF §36.5's own conclusion — that
900ms is a **deliberate UX trade-off**, not a literal match, because Weyn's
Venues chunk is already downloaded and a synthetic 1.5–2.9s spinner would
read as fake rather than matching the video's *feel* — still holds and is
not undermined by this re-measurement. This part of the gap **is** the
network/hardware-dependent kind flagged in the subtask brief: District is
doing a real fetch each switch; Weyn (post first-visit) is not.

## Net conclusions for a follow-up implementation pass (not done here)

1. **Genuine UX gap, not hardware-dependent**: the `ambient-bloom` keyframe's
   spike-to-1.6-opacity shape should be replaced with a shape that doesn't
   overshoot — e.g. drop the 15% keyframe or cap it at ≤1 opacity — to match
   what the video actually does (instant hue-swap + short ease, no flash).
2. **Partially network-dependent, still worth a small nudge**: `900ms` for
   `SWITCH_SKELETON_MS` remains a deliberate, documented trade-off; if a
   future pass wants to lean closer to the freshly measured 1.0–1.9s band
   without reintroducing a "fake spinner" feel, something in the 1000–1200ms
   range would track the low end of the new measurement more closely while
   staying short of the old 2.3–2.9s figure this codebase already decided
   not to chase.
3. No change recommended to the hue-crossfade transition itself
   (`--ambient-top .5s`, `components.css:54`) — its shape (ease, no spike)
   is already closer to the measured behavior than the bloom-pulse layered
   on top of it.
