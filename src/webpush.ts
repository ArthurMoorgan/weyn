// Web Push (VAPID) — the browser/PWA counterpart to push.ts's native-only
// APNs wiring. Opt-in only (called from a Profile toggle, never auto-run on
// load) since requesting Notification permission unprompted is exactly the
// kind of thing that gets a site's permission prompts auto-blocked by the
// browser.

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}

export function webPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function webPushStatus(): Promise<"unsupported" | "denied" | "subscribed" | "available"> {
  if (!webPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "available";
}

export async function subscribeWebPush(api: { getVapidPublicKey: () => Promise<{ publicKey: string | null }>; webPushSubscribe: (s: PushSubscriptionJSON) => Promise<unknown> }) {
  if (!webPushSupported()) throw new Error("Push notifications aren't supported in this browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted.");

  const { publicKey } = await api.getVapidPublicKey();
  if (!publicKey) throw new Error("Push isn't configured on the server yet.");

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api.webPushSubscribe(sub.toJSON());
  return sub;
}

export async function unsubscribeWebPush(api: { webPushUnsubscribe: (endpoint: string) => Promise<unknown> }) {
  if (!webPushSupported()) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.webPushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
