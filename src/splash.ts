let shownAt = 0;
export function markSplashShown() { shownAt = performance.now(); }

// The splash overlay is on screen from the very first paint (index.html adds
// `show-splash` before React exists). The app shell reads this once at mount
// to decide whether to hold hidden for the handoff entrance, or — on a load
// with no splash (already dismissed, or a route that never showed one) — just
// render at rest.
export function splashActive(): boolean {
  return document.documentElement.classList.contains("show-splash");
}

// The shell's entrance is timed to overlap the splash's exit so the swap reads
// as one continuous motion rather than a hard cut. splash.ts owns the timing
// (the min-hold lives here); the shell subscribes via onSplashExit and animates
// itself in when the exit fires. If the exit already ran before the shell
// subscribed, the listener is invoked straight away so it can't stay hidden.
let exited = false;
const exitListeners = new Set<() => void>();
export function onSplashExit(fn: () => void): () => void {
  if (exited) { fn(); return () => {}; }
  exitListeners.add(fn);
  return () => { exitListeners.delete(fn); };
}

// Point the exit's FLIP transform at the header brand's rest position, if a
// visible one exists. Desktop's top bar has a persistent brand; mobile's bottom
// bar doesn't (the element is in the DOM but display:none), and shell-less
// routes have no brand at all — in both cases we leave the vars unset and the
// exit falls back to a centered settle+scale (the splash-mark-settle keyframe).
function aimMarkAtBrand() {
  const svg = document.querySelector<SVGSVGElement>("#splash svg");
  const brand = document.querySelector<HTMLElement>(".sidebar-brand");
  if (!svg || !brand) return;
  const b = brand.getBoundingClientRect();
  if (b.width === 0) return;
  const s = svg.getBoundingClientRect();
  svg.style.setProperty("--splash-mx", `${Math.round(b.left + b.width / 2 - (s.left + s.width / 2))}px`);
  svg.style.setProperty("--splash-my", `${Math.round(b.top + b.height / 2 - (s.top + s.height / 2))}px`);
  svg.style.setProperty("--splash-ms", (b.height / s.height).toFixed(3));
  document.documentElement.classList.add("splash-morph");
}

let scheduled = false;
export function dismissSplash() {
  const root = document.documentElement;
  if (scheduled || !root.classList.contains("show-splash")) return;
  scheduled = true;
  const elapsed = performance.now() - shownAt;
  // Min on-screen time (unchanged): the entry choreography finishes ~660ms
  // (strokes ~370ms, dot ~430ms, wordmark ~660ms — see index.html), plus a
  // short beat so it registers as a brand moment rather than a flash.
  const wait = Math.max(0, 750 - elapsed);
  setTimeout(() => {
    // Aim the mark, then kick the shell's entrance and start the exit in the
    // same frame so the fly-in and the surfacing content overlap. (The shell
    // sits at its small hidden offset until now, so the brand is ~10px off its
    // final rest spot — imperceptible, since the mark is fading as it arrives.)
    aimMarkAtBrand();
    exited = true;
    exitListeners.forEach((fn) => fn());
    root.classList.add("splash-exit");
    setTimeout(() => {
      document.getElementById("splash")?.remove();
      root.classList.remove("show-splash", "splash-exit", "splash-morph");
    }, 480);
  }, wait);
}
