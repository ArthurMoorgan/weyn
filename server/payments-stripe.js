// Stripe Checkout integration — the actual payment processor backing "Weyn
// Ticketing" (see HANDOFF.md/Organizer.tsx's TICKETING_OPTIONS: this option
// was disabled until real payment credentials existed; it's live now that
// STRIPE_SECRET_KEY is configured).
//
// Uses Stripe Checkout (hosted payment page, redirect-based) rather than
// Payment Intents/Elements — same shape as the PayTabs flow it sits
// alongside in payments.js (create a session, redirect the customer, get a
// webhook when it completes), so server/app.js's checkout route didn't need
// to change its own structure to support a second provider.
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let _stripe = null;
function client() {
  if (!_stripe) _stripe = new Stripe(STRIPE_SECRET_KEY);
  return _stripe;
}

export function stripeConfigured() {
  return !!STRIPE_SECRET_KEY;
}

// Currency note: Weyn's prices are OMR (Omani Rial), a 3-decimal-place
// currency (1 OMR = 1000 baisa, not 100) — Stripe's smallest-unit amounts
// assume 2 decimals for most currencies but OMR isn't in Stripe's supported
// currency list at all as of writing. Charging in USD instead (test-mode
// keys, so this is safe to iterate on) at a fixed illustrative rate; swap
// to a real conversion or a supported settlement currency before accepting
// real payments.
const OMR_TO_USD = 2.6;

export async function createCheckoutSession({ booking, event, tier, successUrl, cancelUrl, customerEmail }) {
  const priceOmr = tier ? tier.price : event.price;
  const name = tier ? `${event.title} — ${tier.name}` : event.title;
  const qty = booking.qty || 1;
  const unitAmountUsd = Math.round(priceOmr * OMR_TO_USD * 100); // cents
  const session = await client().checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: unitAmountUsd,
        product_data: { name, description: `${event.venue}, ${event.area}` },
      },
      quantity: qty,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    client_reference_id: booking.id,
    metadata: { bookingId: booking.id, eventId: event.id, tierId: tier?.id || "" },
  });
  return { sessionId: session.id, checkoutUrl: session.url };
}

export async function fetchSessionStatus(sessionId) {
  const session = await client().checkout.sessions.retrieve(sessionId);
  return { success: session.payment_status === "paid", raw: session };
}

// rawBody must be the exact bytes Stripe sent — signature is computed over
// the raw payload, same requirement as PayTabs' HMAC check.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !STRIPE_WEBHOOK_SECRET) return null;
  try {
    return client().webhooks.constructEvent(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  } catch {
    return null;
  }
}
