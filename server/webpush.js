// Web Push (VAPID) sender — reaches browsers/PWAs, which is the channel
// that actually matters today: server/push.js (APNs) only reaches a native
// iOS app, and there is no native app in users' hands yet. Same
// fully-optional shape as push.js: with no VAPID keys configured,
// sendWebPush() logs what it would send and returns
// { sent: false, reason: "not-configured" } — nothing else breaks.
//
// To go live, set:
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — generate with
//     `npx web-push generate-vapid-keys`. The public key is server-only env
//     here — the frontend fetches it at subscribe time via
//     GET /api/push/vapid-public-key (see app.js) rather than needing its
//     own VITE_-prefixed build-time copy of the same value.
//   VAPID_CONTACT_EMAIL — optional, defaults to support@weynevents.com;
//     shown to browser vendors if they need to contact you about abuse.

import webpush from "web-push";

let configured = false;

function init() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || "support@weynevents.com"}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

export function webPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

// subscription: { endpoint, keys: { p256dh, auth } } — the raw shape from
// PushSubscription.toJSON() on the client, or { endpoint, p256dh, auth } as
// stored in WebPushSubscription; both are normalized here.
export async function sendWebPush(subscription, { title, body, data, url } = {}) {
  if (!subscription?.endpoint) return { sent: false, reason: "no-subscription" };
  if (!init()) {
    console.log(`[webpush:dry-run] would notify ${subscription.endpoint.slice(-16)} — "${title}: ${body}"`);
    return { sent: false, reason: "not-configured" };
  }
  const sub = {
    endpoint: subscription.endpoint,
    keys: subscription.keys || { p256dh: subscription.p256dh, auth: subscription.auth },
  };
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, data: data || {}, url }));
    return { sent: true };
  } catch (err) {
    // 404/410 = the browser expired or the user revoked permission — the
    // caller should drop the stored subscription rather than retry it.
    const expired = err.statusCode === 404 || err.statusCode === 410;
    console.warn("[webpush] send error:", err.statusCode || err.message);
    return { sent: false, reason: expired ? "expired" : "error", expired };
  }
}
