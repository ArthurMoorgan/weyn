// OneSignal push sender — replaces the old raw APNs (push.js) and Web Push
// (webpush.js) senders. OneSignal manages device tokens/subscriptions itself
// (registered client-side by the SDK), so the server only ever needs to know
// a Weyn userId — it targets by OneSignal's "external_id" alias, which the
// client sets via OneSignal.login(userId) (see src/push.ts and main.tsx).
//
// Fully optional, same dry-run shape as the senders it replaces: with no
// ONESIGNAL_REST_API_KEY configured, sendOneSignalPush() logs what it would
// send and returns { sent: false, reason: "not-configured" } — the rest of
// the app (booking, dashboard, etc.) keeps working either way.
//
// To go live, set:
//   ONESIGNAL_APP_ID          — from the OneSignal dashboard (Settings → Keys & IDs)
//   ONESIGNAL_REST_API_KEY    — REST API key, same page. Keep this server-only,
//                                never ship it to the client.

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

export function oneSignalConfigured() {
  return !!(process.env.ONESIGNAL_APP_ID && process.env.ONESIGNAL_REST_API_KEY);
}

// externalUserId: Weyn's own User.id — NOT a device token. The OneSignal SDK
// links this device's subscription to that id client-side (OneSignal.login).
export async function sendOneSignalPush(externalUserId, { title, body, data, url } = {}) {
  if (!externalUserId) return { sent: false, reason: "no-user" };
  if (!oneSignalConfigured()) {
    console.log(`[onesignal:dry-run] would notify user ${externalUserId} — "${title}: ${body}"`);
    return { sent: false, reason: "not-configured" };
  }
  try {
    const res = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${process.env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        include_aliases: { external_id: [String(externalUserId)] },
        target_channel: "push",
        headings: { en: title },
        contents: { en: body },
        data: data || {},
        url,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[onesignal] delivery failed:", res.status, text.slice(0, 300));
      return { sent: false, reason: "onesignal-rejected" };
    }
    const json = await res.json().catch(() => ({}));
    if (json.errors?.length) {
      console.warn("[onesignal] delivery errors:", json.errors);
      return { sent: false, reason: "onesignal-rejected" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[onesignal] send error:", err.message);
    return { sent: false, reason: "error" };
  }
}
