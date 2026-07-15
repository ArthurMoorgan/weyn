let shownAt = 0;
export function markSplashShown() { shownAt = performance.now(); }
export function dismissSplash() {
  const root = document.documentElement;
  if (!root.classList.contains("show-splash")) return;
  const elapsed = performance.now() - shownAt;
  // Min on-screen time: the entry choreography (strokes draw by ~900ms,
  // dot pops at ~620ms, wordmark settles by ~1.1s — see index.html's
  // splash <style>) must complete before the exit starts, or the mark
  // gets cut off mid-draw. Long enough to land as a brand moment, short
  // enough to never feel like a loading screen.
  const wait = Math.max(0, 1150 - elapsed);
  setTimeout(() => {
    root.classList.add("splash-exit");
    setTimeout(() => {
      document.getElementById("splash")?.remove();
      root.classList.remove("show-splash", "splash-exit");
    }, 520);
  }, wait);
}
