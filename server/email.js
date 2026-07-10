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

// Organizer-wide team invite — one email, one link per event (each still a
// real per-event EventTeamMember accept flow under the hood, see
// db.organizerTeamInvite's comment on why this isn't a new access model).
export function organizerTeamInviteEmail({ organizerName, role, events }) {
  const roleLabel = role === "MANAGER" ? "manager" : "staff";
  const rows = events.map((e) => `
    <li style="margin-bottom:10px">
      <a href="${e.inviteLink}" style="color:#1C6DD0;font-weight:600">${escapeHtml(e.title)}</a>
    </li>
  `).join("");
  return {
    subject: `${organizerName} invited you to help run their events on Weyn`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">You're invited to the team</h2>
        <p style="color:#444;line-height:1.5">
          ${escapeHtml(organizerName)} added you as <strong>${roleLabel}</strong> across
          ${events.length} event${events.length === 1 ? "" : "s"}. Accept each one below:
        </p>
        <ul style="padding-left:18px;margin:18px 0">${rows}</ul>
      </div>
    `,
  };
}

// Automated T-N reminder (Event.reminderSchedule, "scheduledAnnouncements"
// feature) — distinct from bookingConfirmationEmail, sent once per
// configured offset per booking, not on booking itself.
export function reminderEmail({ eventTitle, whenLabel, venue, ticketUrl }) {
  return {
    subject: `Reminder: ${eventTitle} is in ${whenLabel}`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">Coming up: ${escapeHtml(eventTitle)}</h2>
        <p style="color:#444;line-height:1.5">This is a reminder that it's happening in <strong>${whenLabel}</strong>${venue ? ` at ${escapeHtml(venue)}` : ""}.</p>
        <p style="margin:22px 0">
          <a href="${ticketUrl}" style="background:#1C6DD0;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            View your ticket
          </a>
        </p>
      </div>
    `,
  };
}

// Sent to the person who just joined the waitlist.weynevents.com list —
// confirms it landed and sets expectations (no date promised, since none
// is fixed yet). Kept short: a congratulations email that oversells reads
// worse than one that just confirms and moves on.
export function waitlistWelcomeEmail({ name }) {
  const greeting = name ? `Hey ${escapeHtml(name)},` : "Hey,";
  return {
    subject: "You're on the Weyn waitlist 🎉",
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">${greeting}</h2>
        <p style="color:#444;line-height:1.6">
          Thanks for joining the Weyn waitlist — you're officially on the list.
        </p>
        <p style="color:#444;line-height:1.6">
          We're putting the finishing touches on Weyn, the easiest way to discover events,
          host your own, and reserve a table in Muscat. <strong>We'll email you the moment
          it's ready</strong> — no spam in the meantime, just this one confirmation.
        </p>
        <p style="color:#888;font-size:13px;margin-top:28px">— The Weyn team</p>
      </div>
    `,
  };
}

// Sent to WAITLIST_NOTIFY_EMAIL (the team) every time someone new joins —
// a live count so growth is visible without anyone having to go check the
// database. Best-effort like every other email here: never blocks or
// fails the actual signup if delivery hiccups.
export function waitlistOwnerNotifyEmail({ email, name, role, source, count }) {
  return {
    subject: `New waitlist signup${count ? ` (#${count})` : ""}: ${email}`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">New waitlist signup</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#222;margin:16px 0">
          <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${escapeHtml(email)}</td></tr>
          ${name ? `<tr><td style="padding:6px 0;color:#888">Name</td><td style="padding:6px 0">${escapeHtml(name)}</td></tr>` : ""}
          ${role ? `<tr><td style="padding:6px 0;color:#888">Interested in</td><td style="padding:6px 0">${escapeHtml(role)}</td></tr>` : ""}
          ${source ? `<tr><td style="padding:6px 0;color:#888">Source</td><td style="padding:6px 0">${escapeHtml(source)}</td></tr>` : ""}
          ${count ? `<tr><td style="padding:6px 0;color:#888">Total on list</td><td style="padding:6px 0"><strong>${count}</strong></td></tr>` : ""}
        </table>
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
