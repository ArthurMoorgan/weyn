let shownAt = 0;
export function markSplashShown() { shownAt = performance.now(); }
export function dismissSplash() {
  const root = document.documentElement;
  if (!root.classList.contains("show-splash")) return;
  const elapsed = performance.now() - shownAt;
  const wait = Math.max(0, 500 - elapsed);
  setTimeout(() => {
    root.classList.add("splash-exit");
    try { localStorage.setItem("weyn.hasLaunched", "1"); } catch {}
    setTimeout(() => {
      document.getElementById("splash")?.remove();
      root.classList.remove("show-splash", "splash-exit");
    }, 520);
  }, wait);
}
