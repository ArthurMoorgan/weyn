// PayTabs integration (regional gateway supporting individual/freelancer
// merchant accounts with just a passport/national ID — no commercial
// registration required for that tier). Docs: https://docs.paytabs.com
//
// Safe no-op mode: if PAYTABS_SERVER_KEY isn't set, paytabsConfigured() is
// false and callers should keep paid events off the checkout path (the old
// instant-book path stays free-only).
//
// Unlike Thawani, PayTabs documents a real HMAC-SHA256 signature on every
// IPN/callback (header "Signature", hashed with the profile's server key
// over the raw request body). verifyIpnSignature() checks that directly, so
// a forged webhook is rejected outright rather than merely triggering an
// extra check — though confirmPaymentFromPayTabs() in index.js still
// re-queries the transaction status as defense in depth before mutating
// stock, matching the same belt-and-suspenders approach used elsewhere here.
import crypto from "crypto";

// PayTabs has region-specific domains (secure.paytabs.sa, .ae, .com, etc) —
// confirm the exact one for your profile in the PayTabs dashboard before
// going live; defaults to their global endpoint.
const API_BASE = process.env.PAYTABS_API_BASE || "https://secure.paytabs.com";
const PROFILE_ID = process.env.PAYTABS_PROFILE_ID;
const SERVER_KEY = process.env.PAYTABS_SERVER_KEY;

export function paytabsConfigured() {
  return !!(PROFILE_ID && SERVER_KEY);
}

function headers() {
  return { "Content-Type": "application/json", authorization: SERVER_KEY };
}

// booking: Prisma Booking row (status "pending"). event/tier: for name + price.
export async function createCheckoutSession({ booking, event, tier, successUrl, callbackUrl, customerIp }) {
  const price = tier ? tier.price : event.price;
  const name = tier ? `${event.title} — ${tier.name}` : event.title;
  const body = {
    profile_id: PROFILE_ID,
    tran_type: "sale",
    tran_class: "ecom",
    cart_id: booking.id,
    cart_currency: "OMR",
    cart_amount: +(price * (booking.qty || 1)).toFixed(3),
    cart_description: `${name} × ${booking.qty || 1}`,
    return_url: successUrl,
    callback_url: callbackUrl,
    customer_details: {
      name: booking.name || "Weyn Customer",
      email: booking.email || "guest@weyn.app",
      phone: "00000000",
      street1: event.venue,
      city: event.area,
      state: event.area,
      country: "OM",
      ip: customerIp || "127.0.0.1",
    },
  };
  const res = await fetch(`${API_BASE}/payment/request`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok || json?.code < 0) throw new Error(json?.message || json?.result || "PayTabs checkout creation failed");
  const checkoutUrl = json?.redirect_url || json?.payment_url;
  const tranRef = json?.tran_ref;
  if (!checkoutUrl || !tranRef) throw new Error("PayTabs response was missing redirect_url/tran_ref");
  return { tranRef, checkoutUrl };
}

// Re-fetches the transaction status directly from PayTabs — defense in
// depth alongside the IPN signature check, so callers don't rely solely on
// a webhook body even though it's now cryptographically verified.
export async function fetchTransactionStatus(tranRef) {
  const res = await fetch(`${API_BASE}/payment/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ profile_id: PROFILE_ID, tran_ref: tranRef }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || "Failed to query PayTabs transaction");
  // payment_result.response_status is typically "A" (authorized/success), "D" (declined), "P" (pending), "H" (hold).
  return { success: json?.payment_result?.response_status === "A", raw: json };
}

// rawBody must be the exact bytes PayTabs sent (see the express.json
// `verify` hook in server/index.js) — HMAC is order- and whitespace-sensitive.
export function verifyIpnSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !SERVER_KEY) return false;
  try {
    // rawBody is undefined whenever the request's Content-Type isn't
    // application/json (see the raw-body capture middleware in app.js) —
    // Hmac.update(undefined) throws synchronously, which used to happen
    // outside this try/catch and could crash the whole request.
    const expected = crypto.createHmac("sha256", SERVER_KEY).update(rawBody || Buffer.alloc(0)).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false; // length mismatch, missing body, etc — definitely not a match
  }
}
