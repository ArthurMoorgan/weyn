// Thin Resend wrapper. Without RESEND_API_KEY set, sendEmail() is a silent
// no-op — every caller treats email as a nice-to-have alongside a copy-link,
// never the only way to deliver something (see team invite route).
const FROM = process.env.RESEND_FROM || "Weyn <noreply@weynevents.com>";

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

export function teamInviteEmail({ eventTitle, role, inviteLink }) {
  const roleLabel = role === "MANAGER" ? "manager" : "staff";
  return {
    subject: `You've been invited to help run "${eventTitle}" on Weyn`,
    html: `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">You're invited to the team</h2>
        <p style="color:#444;line-height:1.5">
          You've been invited as <strong>${roleLabel}</strong> for
          <strong>${eventTitle}</strong> on Weyn.
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
