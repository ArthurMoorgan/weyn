let shownAt = 0;
export function markSplashShown() { shownAt = performance.now(); }
export function dismissSplash() {
  const root = document.documentElement;
  if (!root.classList.contains("show-splash")) return;
  const elapsed = performance.now() - shownAt;
  // Min on-screen time: retimed down from 1150ms after feedback that the
  // fixed hold made every load feel slow. The entry choreography (strokes
  // draw by ~370ms, dot pops ~430ms, wordmark settles ~660ms — see
  // index.html's splash <style>, retimed to match) needs to finish before
  // the exit starts, plus a short beat to actually register as a brand
  // moment rather than a flash.
  const wait = Math.max(0, 750 - elapsed);
  setTimeout(() => {
    root.classList.add("splash-exit");
    setTimeout(() => {
      document.getElementById("splash")?.remove();
      root.classList.remove("show-splash", "splash-exit");
    }, 380);
  }, wait);
}
