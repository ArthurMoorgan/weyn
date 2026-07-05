// Provider router — Weyn Ticketing now supports two payment gateways:
// Stripe (server/payments-stripe.js) and PayTabs (server/payments-paytabs.js,
// the original regional-gateway integration, kept intact and untouched).
// Stripe wins when both happen to be configured; in practice only one will
// ever have real credentials at a time. server/app.js only ever talks to
// this file, never to the two provider modules directly, so the checkout
// route doesn't need to know which gateway is actually live.
import * as stripeProvider from "./payments-stripe.js";
import * as paytabsProvider from "./payments-paytabs.js";

export function paymentsConfigured() {
  return stripeProvider.stripeConfigured() || paytabsProvider.paytabsConfigured();
}

// Back-compat name — server/app.js's existing call sites use this.
export const paytabsConfigured = paymentsConfigured;

function activeProvider() {
  return stripeProvider.stripeConfigured() ? "stripe" : "paytabs";
}

// booking: Prisma Booking row (status "pending"). event/tier: for name + price.
// Returns { checkoutUrl, providerRef } — providerRef is a Stripe session id
// or a PayTabs tran_ref depending on which gateway ran; callers store it in
// whichever of Payment.stripeSessionId/paytabsTranRef matches (see
// server/app.js's POST /api/events/:id/checkout).
export async function createCheckoutSession({ booking, event, tier, successUrl, callbackUrl, cancelUrl, customerIp }) {
  if (activeProvider() === "stripe") {
    const { sessionId, checkoutUrl } = await stripeProvider.createCheckoutSession({
      booking, event, tier, successUrl, cancelUrl: cancelUrl || successUrl, customerEmail: booking.email,
    });
    return { provider: "stripe", providerRef: sessionId, checkoutUrl };
  }
  const { tranRef, checkoutUrl } = await paytabsProvider.createCheckoutSession({ booking, event, tier, successUrl, callbackUrl, customerIp });
  return { provider: "paytabs", providerRef: tranRef, checkoutUrl };
}

// Re-queries the gateway directly — defense in depth alongside webhook
// signature verification, so callers never rely solely on a webhook body.
export async function fetchTransactionStatus(provider, providerRef) {
  if (provider === "stripe") return stripeProvider.fetchSessionStatus(providerRef);
  return paytabsProvider.fetchTransactionStatus(providerRef);
}

// Stripe and PayTabs sign webhooks completely differently (Stripe:
// `stripe-signature` header + constructEvent, which also parses the body;
// PayTabs: a raw HMAC over the body in a `Signature` header) — this tries
// Stripe first since a Stripe event object round-trips real parsed data,
// then falls back to the PayTabs boolean check. Returns
// { provider, providerRef, valid } so the webhook route knows which
// provider's Payment row to look up.
export function verifyWebhook(rawBody, headers) {
  const stripeEvent = stripeProvider.verifyWebhookSignature(rawBody, headers["stripe-signature"]);
  if (stripeEvent) {
    const session = stripeEvent.data?.object;
    return { provider: "stripe", valid: true, providerRef: session?.id, event: stripeEvent };
  }
  const paytabsValid = paytabsProvider.verifyIpnSignature(rawBody, headers["signature"] || headers["Signature"]);
  return { provider: "paytabs", valid: paytabsValid, providerRef: null };
}
