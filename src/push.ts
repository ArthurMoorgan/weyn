// Push notification wiring — OneSignal on both native (Capacitor iOS, via
// the Cordova plugin) and web (PWA, via the Web SDK). OneSignal owns device
// registration and subscription management itself; all this module does is
// (1) initialize the right SDK for the platform and ask for permission, and
// (2) link this device's subscription to Weyn's own userId via
// OneSignal.login()/logout() so the server can target a *person* (see
// server/onesignal.js's sendOneSignalPush) instead of a raw device token.
import { Capacitor } from "@capacitor/core";

const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined;

let webInitialized = false;

async function initNative() {
  if (!ONESIGNAL_APP_ID) return;
  try {
    const OneSignal = (await import("onesignal-cordova-plugin")).default;
    OneSignal.initialize(ONESIGNAL_APP_ID);
    // requestPermission() shows the native OS prompt; OneSignal handles the
    // registration/token dance with APNs internally from here on.
    await OneSignal.Notifications.requestPermission(true);
  } catch (err) {
    console.warn("[push] native OneSignal init failed:", (err as Error).message);
  }
}

async function initWeb() {
  if (webInitialized || !ONESIGNAL_APP_ID) return;
  try {
    const OneSignal = (await import("react-onesignal")).default;
    await OneSignal.init({ appId: ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true });
    webInitialized = true;
  } catch (err) {
    console.warn("[push] web OneSignal init failed:", (err as Error).message);
  }
}

// Called once at app startup (see main.tsx) — sets up the SDK for whichever
// platform this is. Safe to call unconditionally; both branches no-op
// gracefully if OneSignal isn't configured (no VITE_ONESIGNAL_APP_ID) or the
// user declines the permission prompt.
export async function initPush() {
  if (Capacitor.isNativePlatform()) {
    await initNative();
  } else {
    await initWeb();
  }
}

// Request web push permission specifically — kept separate from initWeb()
// so callers can ask for it at a deliberate, non-intrusive moment (mirrors
// the native permission request that already happens inside initNative()).
export async function requestWebPushPermission() {
  if (Capacitor.isNativePlatform()) return;
  if (!webInitialized) await initWeb();
  if (!webInitialized) return;
  try {
    const OneSignal = (await import("react-onesignal")).default;
    await OneSignal.Notifications.requestPermission();
  } catch (err) {
    console.warn("[push] web permission request failed:", (err as Error).message);
  }
}

// Link this device's OneSignal subscription to Weyn's own userId (from
// /api/me — see src/store.ts's useAccount) so server-side notifyUser(userId)
// calls (server/app.js) can reach this device. Call on sign-in.
export async function identifyPushUser(userId: string) {
  if (!ONESIGNAL_APP_ID || !userId) return;
  try {
    if (Capacitor.isNativePlatform()) {
      const OneSignal = (await import("onesignal-cordova-plugin")).default;
      OneSignal.login(userId);
    } else {
      if (!webInitialized) await initWeb();
      const OneSignal = (await import("react-onesignal")).default;
      await OneSignal.login(userId);
    }
  } catch (err) {
    console.warn("[push] identifyPushUser failed:", (err as Error).message);
  }
}

// Unlink this device from whichever userId it was logged in as. Call on
// sign-out so a shared/kiosk device stops being associated with the
// previous account.
export async function clearPushUser() {
  if (!ONESIGNAL_APP_ID) return;
  try {
    if (Capacitor.isNativePlatform()) {
      const OneSignal = (await import("onesignal-cordova-plugin")).default;
      OneSignal.logout();
    } else if (webInitialized) {
      const OneSignal = (await import("react-onesignal")).default;
      await OneSignal.logout();
    }
  } catch (err) {
    console.warn("[push] clearPushUser failed:", (err as Error).message);
  }
}
