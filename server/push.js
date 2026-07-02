// APNs sender. Fully optional: with no credentials configured, sendPush() logs
// what it *would* send and returns { sent: false, reason: "not-configured" } —
// the rest of the app (booking, dashboard, etc.) keeps working either way.
//
// To go live, set these env vars (from your Apple Developer account):
//   APN_KEY_ID      — Keys ID for the .p8 (Certificates, Identifiers & Profiles → Keys)
//   APN_TEAM_ID     — your 10-character Apple Developer Team ID
//   APN_BUNDLE_ID   — defaults to com.weyn.app
//   APN_KEY         — the FULL CONTENTS of the .p8 file (paste as-is, including
//                     the BEGIN/END lines), or APN_KEY_BASE64 (base64 of the file)
//   APN_PRODUCTION  — "true" once the app is TestFlight/App Store signed;
//                     leave unset/"false" for a dev-signed build from Xcode

import apn from "@parse/node-apn";

let provider = null;
let bundleId = process.env.APN_BUNDLE_ID || "com.weyn.app";

function init() {
  if (provider) return provider;
  const { APN_KEY_ID, APN_TEAM_ID, APN_KEY, APN_KEY_BASE64 } = process.env;
  const keyContents = APN_KEY || (APN_KEY_BASE64 ? Buffer.from(APN_KEY_BASE64, "base64").toString("utf8") : null);
  if (!APN_KEY_ID || !APN_TEAM_ID || !keyContents) return null; // not configured — caller handles gracefully

  provider = new apn.Provider({
    token: { key: keyContents, keyId: APN_KEY_ID, teamId: APN_TEAM_ID },
    production: process.env.APN_PRODUCTION === "true",
  });
  return provider;
}

export function pushConfigured() {
  return !!(process.env.APN_KEY_ID && process.env.APN_TEAM_ID && (process.env.APN_KEY || process.env.APN_KEY_BASE64));
}

export async function sendPush(token, { title, body, data } = {}) {
  if (!token) return { sent: false, reason: "no-token" };
  const p = init();
  if (!p) {
    console.log(`[push:dry-run] would notify ${token.slice(0, 10)}… — "${title}: ${body}"`);
    return { sent: false, reason: "not-configured" };
  }
  const note = new apn.Notification();
  note.alert = { title, body };
  note.sound = "default";
  note.topic = bundleId;
  note.payload = data || {};
  try {
    const result = await p.send(note, token);
    if (result.failed?.length) {
      console.warn("[push] delivery failed:", result.failed[0]?.response || result.failed[0]?.status);
      return { sent: false, reason: "apns-rejected" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[push] send error:", err.message);
    return { sent: false, reason: "error" };
  }
}
