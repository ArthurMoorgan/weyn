let shownAt = 0;
export function markSplashShown() { shownAt = performance.now(); }
export function dismissSplash() {
  const root = document.documentElement;
  if (!root.classList.contains("show-splash")) return;
  const elapsed = performance.now() - shownAt;
  // Min on-screen time: long enough to register as a brand moment on every
  // cold boot (index.html shows it unconditionally now), short enough to
  // never feel like a loading screen.
  const wait = Math.max(0, 650 - elapsed);
  setTimeout(() => {
    root.classList.add("splash-exit");
    setTimeout(() => {
      document.getElementById("splash")?.remove();
      root.classList.remove("show-splash", "splash-exit");
    }, 520);
  }, wait);
}
