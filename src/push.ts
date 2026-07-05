// Native push notification wiring. A complete no-op on web (Capacitor.isNativePlatform()
// is false in the browser), so this is always safe to call from main.tsx.
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "./api";
import { getDeviceId, getDeviceSecret } from "./store";

export async function initPush() {
  if (!Capacitor.isNativePlatform()) return; // web/PWA: no native APNs, skip entirely

  try {
    const perm = await PushNotifications.checkPermissions();
    let status = perm.receive;
    if (status === "prompt" || status === "prompt-with-rationale") {
      status = (await PushNotifications.requestPermissions()).receive;
    }
    if (status !== "granted") return; // user declined — respect it, no retry loop

    PushNotifications.addListener("registration", (token) => {
      api.registerPush(getDeviceId(), getDeviceSecret(), token.value, Capacitor.getPlatform()).catch(() => {
        // registration failing shouldn't break the app — the reminder scanner
        // just won't have a token for this device until the next successful call
      });
    });
    PushNotifications.addListener("registrationError", (err) => {
      console.warn("[push] registration error:", err.error);
    });

    await PushNotifications.register();
  } catch (err) {
    console.warn("[push] init skipped:", (err as Error).message);
  }
}
