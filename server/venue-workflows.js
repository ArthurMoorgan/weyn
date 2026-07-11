// Venue Workflows — the contained, real MVP of an "automation builder":
// trigger -> condition -> action, evaluated immediately when the trigger
// event actually happens (a reservation is created/cancelled/no-shows),
// not on a poll cycle. Deliberately NOT the full drag-and-drop
// node-canvas/branches/loops/marketplace vision — that's a much larger
// build than what's needed to prove the pattern is real and useful; this
// gives staff working "if X, then Y" rules today, with the state machine
// (Trigger, Condition, Action as three real, typed things a rule is made
// of) already shaped so a visual canvas could be layered on top later
// without changing the underlying model.
import { prisma, db } from "./db.js";
import { sendEmail } from "./email.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Every condition/action a rule can be built from today — the frontend's
// rule builder reads this same shape indirectly (mirrored in
// src/pages/venue-os/Workspace.tsx) so the UI never offers a combination
// the backend can't actually evaluate/execute.
export const VENUE_TRIGGERS = ["reservation_created", "reservation_cancelled", "guest_no_show"];
export const VENUE_ACTIONS = ["notify_owner", "tag_guest", "send_guest_email"];

async function conditionMet(rule, reservation) {
  const cfg = rule.config || {};
  if (cfg.minPartySize && reservation.partySize < Number(cfg.minPartySize)) return false;
  if (cfg.requireTag) {
    const note = await prisma.venueGuestNote.findUnique({ where: { venueId_guestEmail: { venueId: reservation.venueId, guestEmail: reservation.guestEmail.toLowerCase() } } });
    if (!note || !note.tags.includes(cfg.requireTag)) return false;
  }
  return true;
}

async function runAction(rule, reservation, venue) {
  const cfg = rule.config || {};
  if (rule.action === "notify_owner") {
    if (!venue.owner?.email) return;
    const subject = `${venue.name}: ${rule.name}`;
    const safeMessage = escapeHtml(cfg.message || `${reservation.guestName} — party of ${reservation.partySize}, ${reservation.date.toISOString().slice(0, 10)} ${reservation.time}.`);
    await sendEmail({
      to: venue.owner.email, subject,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${escapeHtml(rule.name)}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p></div>`,
    }).catch(() => {});
  } else if (rule.action === "tag_guest" && cfg.tag) {
    const guestEmail = reservation.guestEmail.toLowerCase();
    await prisma.venueGuestNote.upsert({
      where: { venueId_guestEmail: { venueId: reservation.venueId, guestEmail } },
      create: { venueId: reservation.venueId, guestEmail, note: "", tags: [cfg.tag] },
      update: { tags: { push: cfg.tag } },
    }).catch(() => {});
  } else if (rule.action === "send_guest_email" && cfg.message) {
    const safeSubject = escapeHtml(cfg.subject || "An update on your reservation");
    const safeMessage = escapeHtml(cfg.message);
    const safeVenueName = escapeHtml(venue.name);
    await sendEmail({
      to: reservation.guestEmail, subject: `${venue.name}: ${cfg.subject || "An update"}`,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you've booked with ${safeVenueName}.</p></div>`,
    }).catch(() => {});
  }
}

// Called right at the point each trigger genuinely happens (reservation
// create/status-update routes) — never a batch scan, so "reservation
// created" fires the same second it's created, not up to 5 minutes later.
export async function runVenueWorkflows(trigger, reservation) {
  try {
    const rules = await prisma.automationRule.findMany({ where: { venueId: reservation.venueId, trigger, enabled: true } });
    if (!rules.length) return;
    const venue = await prisma.venue.findUnique({ where: { id: reservation.venueId }, include: { owner: { select: { email: true } } } });
    if (!venue) return;
    for (const rule of rules) {
      if (!(await conditionMet(rule, reservation))) continue;
      await runAction(rule, reservation, venue);
      await db.audit("automation.executed", { actorId: null, entityType: "automation", entityId: rule.id, metadata: { trigger, reservationId: reservation.id, venueId: reservation.venueId } });
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
    }
  } catch {
    // Best-effort — a broken workflow rule should never block the
    // reservation action that triggered it.
  }
}
