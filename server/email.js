// Thin Resend wrapper. Without RESEND_API_KEY set, sendEmail() is a silent
// no-op — every caller treats email as a nice-to-have alongside a copy-link,
// never the only way to deliver something (see team invite route).
const FROM = process.env.RESEND_FROM || "Weyn <noreply@weynevents.com>";

// eventTitle/venue below are organizer-controlled free text with no
// HTML-stripping anywhere in their pipeline — escape before interpolating
// into an email actually sent to attendees from a trusted, branded address.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail({ to, subject, html }) {
  if (!emailConfigured()) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
  return res.json();
}

// Booking confirmation — sent on both the free-RSVP path and the paid
// webhook path (see server/app.js). Previously a booking only ever
// triggered a push notification, which needs a registered device/token; a
// user who booked without ever granting push permission (or on a browser
// with no push support) got NO confirmation of any kind. Email is
// best-effort like every other email here — only sent when Booking.email
// is present (collected optionally on free RSVP, and from the checkout
// form on paid bookings).
export function bookingConfirmationEmail({ eventTitle, dateLabel, venue, ticketUrl, free }) {
  const safeTitle = escapeHtml(eventTitle);
  return {
    subject: `You're going: ${eventTitle}`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">You're going! 🎟</h2>
        <p style="color:#444;line-height:1.5">
          Your ${free ? "spot" : "ticket"} for <strong>${safeTitle}</strong> is confirmed.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#222;margin:16px 0">
          <tr><td style="padding:6px 0;color:#888">When</td><td style="padding:6px 0">${escapeHtml(dateLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Where</td><td style="padding:6px 0">${escapeHtml(venue)}</td></tr>
        </table>
        <p style="margin:22px 0">
          <a href="${ticketUrl}" style="background:#1C6DD0;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            View your ticket
          </a>
        </p>
        <p style="color:#888;font-size:12px">We'll remind you again before it starts.</p>
      </div>
    `,
  };
}

// Sent to the ORGANIZER when an attendee clicks "I've sent the payment" on
// the organizer_payment checkout page — purely a nudge to go confirm it,
// never proof of payment on its own (see Booking.claimedPaidAt's comment).
export function organizerPaymentClaimEmail({ eventTitle, buyerName, buyerEmail, amount, manageUrl }) {
  return {
    subject: `Payment claim for "${eventTitle}" — confirm to issue the ticket`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">Someone says they've paid</h2>
        <p style="color:#444;line-height:1.5">
          ${escapeHtml(buyerName || buyerEmail || "A buyer")} says they've sent payment for
          <strong>${escapeHtml(eventTitle)}</strong> (${amount.toFixed(2)} OMR). Their ticket won't be issued
          until you confirm the payment actually arrived.
        </p>
        <p style="margin:22px 0">
          <a href="${manageUrl}" style="background:#1C6DD0;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Review &amp; confirm payment
          </a>
        </p>
      </div>
    `,
  };
}

export function teamInviteEmail({ eventTitle, role, inviteLink }) {
  const roleLabel = role === "MANAGER" ? "manager" : "staff";
  return {
    subject: `You've been invited to help run "${eventTitle}" on Weyn`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">You're invited to the team</h2>
        <p style="color:#444;line-height:1.5">
          You've been invited as <strong>${roleLabel}</strong> for
          <strong>${escapeHtml(eventTitle)}</strong> on Weyn.
        </p>
        <p style="margin:24px 0">
          <a href="${inviteLink}" style="background:#7C5CFF;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept invite
          </a>
        </p>
        <p style="color:#888;font-size:13px">${inviteLink}</p>
      </div>
    `,
  };
}
