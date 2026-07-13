// Meta (Instagram + Facebook) integration — OAuth connect + real content
// publishing via the Instagram Graph API. Parked-integration pattern (see
// server/email.js's Resend wrapper and HANDOFF.md §4.5's Stripe plan):
// fully code-complete, but every entry point checks metaConfigured() first
// and fails with a clear, typed error instead of crashing whenever
// META_APP_ID/META_APP_SECRET/META_REDIRECT_URI aren't set — which is the
// case in every environment today, so nothing here can fire by accident.
import { encryptSecret, decryptSecret, encryptionConfigured } from "./crypto-secrets.js";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function metaConfigured() {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

// Thrown by every route below when the integration isn't configured yet —
// server/app.js turns this into a 503 {code:"INTEGRATION_NOT_CONFIGURED"}.
export class IntegrationNotConfiguredError extends Error {
  constructor(message = "Meta (Instagram/Facebook) isn't connected on this deployment yet.") {
    super(message);
    this.code = "INTEGRATION_NOT_CONFIGURED";
    this.status = 503;
  }
}

function assertConfigured() {
  if (!metaConfigured()) throw new IntegrationNotConfiguredError();
  if (!encryptionConfigured()) {
    throw new IntegrationNotConfiguredError("Token encryption isn't configured (SOCIAL_TOKEN_ENC_KEY missing) — refusing to store a Meta access token unencrypted.");
  }
}

// Scopes needed to: read the organizer's Facebook Pages, find the linked
// Instagram Business Account, and publish content to it. instagram_basic +
// instagram_content_publish are the Graph API's actual publish scopes;
// pages_show_list/pages_read_engagement are needed to resolve the Page ->
// IG Business Account link at connect-time.
const SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"].join(",");

// Step 1: build the URL the "Connect Instagram/Facebook" button redirects to.
export function buildMetaOAuthUrl(state) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state,
    scope: SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

// Step 2: OAuth callback — exchange the code for a short-lived user token,
// upgrade it to a long-lived one, then resolve the first connected Facebook
// Page + its linked Instagram Business Account (what we actually post to).
export async function exchangeCodeForConnection(code) {
  assertConfigured();

  const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  tokenUrl.search = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code,
  }).toString();
  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) throw new Error(`Meta token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  const { access_token: shortLivedToken } = await tokenRes.json();

  // Long-lived token (~60 days) — short-lived ones expire in ~1-2 hours,
  // unusable for an organizer who connects once and expects it to keep
  // working.
  const longUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  longUrl.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  }).toString();
  const longRes = await fetch(longUrl);
  if (!longRes.ok) throw new Error(`Meta long-lived token exchange failed (${longRes.status}): ${await longRes.text()}`);
  const { access_token: longLivedToken, expires_in: expiresIn } = await longRes.json();

  // Resolve the organizer's Facebook Pages, then each Page's linked IG
  // Business Account — the actual thing content-publishing posts to.
  const pagesUrl = new URL(`${GRAPH_BASE}/me/accounts`);
  pagesUrl.search = new URLSearchParams({ access_token: longLivedToken, fields: "id,name,instagram_business_account" }).toString();
  const pagesRes = await fetch(pagesUrl);
  if (!pagesRes.ok) throw new Error(`Meta pages lookup failed (${pagesRes.status}): ${await pagesRes.text()}`);
  const { data: pages } = await pagesRes.json();
  const pageWithIg = (pages || []).find((p) => p.instagram_business_account);
  if (!pageWithIg) {
    throw new Error("No Facebook Page with a linked Instagram Business Account was found for this login. Make sure your Instagram is a Business/Creator account connected to a Facebook Page.");
  }

  return {
    accessTokenEnc: encryptSecret(longLivedToken),
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    pageId: pageWithIg.id,
    pageName: pageWithIg.name,
    igBusinessAccountId: pageWithIg.instagram_business_account.id,
  };
}

// Real posting: container-create -> publish, the two-step flow the
// Instagram Graph API's content-publishing endpoint requires. imageUrl
// must be a publicly reachable URL (Weyn's Blob-hosted Event.image already
// is, per the task spec) — Meta fetches it server-side, it isn't uploaded
// as multipart from here.
export async function publishInstagramPost(connection, { imageUrl, caption }) {
  assertConfigured();
  const accessToken = decryptSecret(connection.accessTokenEnc);
  const igId = connection.igBusinessAccountId;

  const containerRes = await fetch(`${GRAPH_BASE}/${igId}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
  });
  if (!containerRes.ok) throw new Error(`Instagram container create failed (${containerRes.status}): ${await containerRes.text()}`);
  const { id: creationId } = await containerRes.json();

  const publishRes = await fetch(`${GRAPH_BASE}/${igId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  if (!publishRes.ok) throw new Error(`Instagram publish failed (${publishRes.status}): ${await publishRes.text()}`);
  const { id: mediaId } = await publishRes.json();
  return { externalPostId: mediaId };
}
