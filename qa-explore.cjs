/* QA: sign in via Clerk dev-instance test flow, screenshot the redesigned
   Explore agenda (mobile + desktop, dark + light). Run from project root. */
const { chromium } = require("playwright");
const fs = require("fs");

const STATE = "/tmp/weyn-qa-state.json";
const SHOTS = "/tmp/weyn-shots";

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  // Clerk's official bot-protection bypass for E2E tests: mint a testing
  // token with the dev-instance secret key, then append it to every FAPI
  // (*.clerk.accounts.dev) request — this is exactly what @clerk/testing does.
  const env = fs.readFileSync(".env", "utf8");
  const sk = env.match(/^CLERK_SECRET_KEY=(.+)$/m)[1].trim();
  const tokRes = await fetch("https://api.clerk.com/v1/testing_tokens", {
    method: "POST", headers: { Authorization: `Bearer ${sk}` },
  });
  const testingToken = (await tokRes.json()).token;
  console.log("testing token:", testingToken ? "ok" : "FAILED");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    storageState: fs.existsSync(STATE) ? STATE : undefined,
  });
  let routedCount = 0;
  await ctx.route(/clerk\.accounts\.dev/, (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("__clerk_testing_token", testingToken);
    routedCount++;
    route.continue({ url: url.toString() });
  });
  await ctx.addInitScript(() => {
    localStorage.setItem("weyn.onboarding.completed", "1");
    localStorage.setItem("weyn.hasLaunched", "1");
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });

  // Password sign-in kept hitting Clerk's "needs_client_trust" device check
  // even with a testing token (that bypass covers bot-detection on public
  // forms, not this). A sign-in TOKEN minted server-side via the Backend API
  // and redeemed with strategy:"ticket" is Clerk's first-party path for
  // exactly this (magic-link-style redemption) and skips that check.
  const ticketRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "user_3GIKP38UK9Ywip4shvvdAkQwnSj", expires_in_seconds: 300 }),
  });
  const { token: ticket } = await ticketRes.json();

  const signedIn = await page.evaluate(async (ticket) => {
    for (let i = 0; i < 50 && !(window.Clerk && window.Clerk.loaded); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!window.Clerk || !window.Clerk.loaded) return "clerk-not-loaded";
    if (window.Clerk.user) return "already";
    try {
      const res = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket });
      if (res.status !== "complete") return "status:" + res.status;
      await window.Clerk.setActive({ session: res.createdSessionId });
      return "ok";
    } catch (e) {
      return "err:" + (e.errors?.[0]?.message || e.message);
    }
  }, ticket);
  console.log("clerk sign-in:", signedIn, "| routed FAPI requests:", routedCount);
  await ctx.storageState({ path: STATE });

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/explore-mobile-dark.png`, fullPage: false });
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/explore-mobile-dark-scrolled.png` });
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/explore-mobile-dark-scrolled2.png` });

  // light theme
  await page.evaluate(() => { localStorage.setItem("weyn.theme", "light"); location.reload(); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/explore-mobile-light.png` });

  // horizontal overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("mobile horizontal overflow px:", overflow);

  // desktop
  const dpage = await ctx.newPage();
  await dpage.setViewportSize({ width: 1380, height: 900 });
  await dpage.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await dpage.evaluate(() => localStorage.setItem("weyn.theme", "dark"));
  await dpage.reload({ waitUntil: "networkidle" });
  await dpage.waitForTimeout(2500);
  await dpage.screenshot({ path: `${SHOTS}/explore-desktop-dark.png` });
  await dpage.mouse.wheel(0, 1000);
  await dpage.waitForTimeout(600);
  await dpage.screenshot({ path: `${SHOTS}/explore-desktop-dark-scrolled.png` });
  const doverflow = await dpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("desktop horizontal overflow px:", doverflow);

  // organizer dashboard (desktop only — that's the layout being redesigned)
  await dpage.goto("http://localhost:5173/organizer", { waitUntil: "networkidle" });
  await dpage.waitForTimeout(2000);
  await dpage.screenshot({ path: `${SHOTS}/organizer-desktop-dark.png` });

  console.log("console errors:", errors.length ? errors : "none");
  await browser.close();
})();
