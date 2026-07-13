// Venue Workflows — the visual node-graph automation builder. A graph is
// one trigger node -> condition node(s) -> action node(s), connected by
// edges. Evaluated immediately when the trigger event actually happens (a
// reservation is created/cancelled/no-shows) — never a poll cycle, since
// these are all already real-time events. Deliberately NOT modeling true
// if/else branching (a condition either continues down its own children
// or stops that path — there's no separate "else" path), loops,
// approvals, or scheduled/retry execution: this is the real, working core
// of an automation builder, not the entire master-prompt vision at once.
import { prisma } from "./db.js";
import { sendEmail } from "./email.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const VENUE_TRIGGERS = ["reservation_created", "reservation_cancelled", "guest_no_show"];
export const CONDITION_FIELDS = ["partySize", "guestTag", "reservationSource", "reservationNotes"];
export const VENUE_ACTIONS = ["notify_owner", "tag_guest", "send_guest_email", "send_guest_sms"];

// Validates a graph's shape at save time — exactly one trigger node,
// every edge references a real node, node `data` matches its type's
// expected fields. Doesn't reject unreachable nodes (a work-in-progress
// graph with a dangling node is fine to save, just won't do anything for
// that branch yet).
export function validateWorkflowGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return "nodes and edges must be arrays";
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) return "A workflow needs exactly one trigger node";
  if (!VENUE_TRIGGERS.includes(triggers[0].data?.trigger)) return "Invalid trigger type";
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) return "An edge references a node that doesn't exist";
  }
  for (const n of nodes) {
    if (n.type === "condition" && !CONDITION_FIELDS.includes(n.data?.field)) return "Invalid condition field";
    if (n.type === "action" && !VENUE_ACTIONS.includes(n.data?.action)) return "Invalid action type";
  }
  return null;
}

function evaluateCondition(node, reservation, guestTags) {
  const { field, op, value } = node.data || {};
  if (field === "partySize") {
    const v = Number(value);
    if (op === ">=") return reservation.partySize >= v;
    if (op === "<=") return reservation.partySize <= v;
    return reservation.partySize === v;
  }
  if (field === "guestTag") {
    const has = guestTags.includes(String(value));
    return op === "not_has" ? !has : has;
  }
  if (field === "reservationSource") {
    return String(reservation.source || "") === String(value);
  }
  if (field === "reservationNotes") {
    const notes = String(reservation.notes || "").toLowerCase();
    const has = notes.includes(String(value || "").toLowerCase());
    return op === "not_contains" ? !has : has;
  }
  return true;
}

async function runActionNode(node, reservation, venue) {
  const cfg = node.data?.config || {};
  const action = node.data?.action;
  try {
    if (action === "notify_owner") {
      if (!venue.owner?.email) return { nodeId: node.id, action, ok: false, error: "No owner email on file" };
      const safeMessage = escapeHtml(cfg.message || `${reservation.guestName} — party of ${reservation.partySize}, ${reservation.date.toISOString().slice(0, 10)} ${reservation.time}.`);
      await sendEmail({
        to: venue.owner.email, subject: `${venue.name}: ${cfg.subject || "Workflow alert"}`,
        html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${escapeHtml(cfg.subject || "Workflow alert")}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p></div>`,
      });
    } else if (action === "tag_guest" && cfg.tag) {
      const guestEmail = reservation.guestEmail.toLowerCase();
      await prisma.venueGuestNote.upsert({
        where: { venueId_guestEmail: { venueId: reservation.venueId, guestEmail } },
        create: { venueId: reservation.venueId, guestEmail, note: "", tags: [cfg.tag] },
        update: { tags: { push: cfg.tag } },
      });
    } else if (action === "send_guest_sms") {
      // No SMS provider (e.g. Twilio) is wired up anywhere in this codebase
      // yet — the catalog entry is visible in the UI so the feature reads
      // complete, but we never pretend a text actually went out.
      return { nodeId: node.id, action, ok: false, error: "SMS isn't set up for this venue yet" };
    } else if (action === "send_guest_email" && cfg.message) {
      const safeSubject = escapeHtml(cfg.subject || "An update on your reservation");
      const safeMessage = escapeHtml(cfg.message);
      const safeVenueName = escapeHtml(venue.name);
      await sendEmail({
        to: reservation.guestEmail, subject: `${venue.name}: ${cfg.subject || "An update"}`,
        html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${safeSubject}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p><p style="color:#888;font-size:12px;margin-top:20px">You're receiving this because you've booked with ${safeVenueName}.</p></div>`,
      });
    }
    return { nodeId: node.id, action, ok: true };
  } catch (err) {
    return { nodeId: node.id, action, ok: false, error: err.message || String(err) };
  }
}

// Walks the graph depth-first from the trigger node. A condition node that
// fails prunes that entire branch (its children never run); an action
// node always runs and its own children continue afterward (so actions
// can chain, e.g. tag-then-notify).
async function walk(node, byId, childrenOf, reservation, venue, guestTags, matched) {
  const children = childrenOf.get(node.id) || [];
  for (const childId of children) {
    const child = byId.get(childId);
    if (!child) continue;
    if (child.type === "condition") {
      if (!evaluateCondition(child, reservation, guestTags)) continue;
      await walk(child, byId, childrenOf, reservation, venue, guestTags, matched);
    } else if (child.type === "action") {
      matched.push(await runActionNode(child, reservation, venue));
      await walk(child, byId, childrenOf, reservation, venue, guestTags, matched);
    }
  }
}

export async function runWorkflowGraph(workflow, reservation, venue, guestTags) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source).push(e.target);
  }
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;
  const matched = [];
  await walk(trigger, byId, childrenOf, reservation, venue, guestTags, matched);
  const status = matched.length === 0 ? "success" : matched.every((m) => m.ok) ? "success" : matched.some((m) => m.ok) ? "partial" : "failed";
  return { matched, status };
}

// Called right at the point each trigger genuinely happens (reservation
// create/status-update routes) — never a batch scan.
export async function runVenueWorkflows(trigger, reservation) {
  try {
    const workflows = await prisma.workflow.findMany({ where: { venueId: reservation.venueId, enabled: true } });
    if (!workflows.length) return;
    const relevant = workflows.filter((w) => (w.nodes || []).some((n) => n.type === "trigger" && n.data?.trigger === trigger));
    if (!relevant.length) return;
    const [venue, note] = await Promise.all([
      prisma.venue.findUnique({ where: { id: reservation.venueId }, include: { owner: { select: { email: true } } } }),
      prisma.venueGuestNote.findUnique({ where: { venueId_guestEmail: { venueId: reservation.venueId, guestEmail: reservation.guestEmail.toLowerCase() } } }),
    ]);
    if (!venue) return;
    const guestTags = note?.tags || [];
    for (const workflow of relevant) {
      const result = await runWorkflowGraph(workflow, reservation, venue, guestTags);
      if (!result) continue;
      await prisma.workflowRun.create({
        data: { workflowId: workflow.id, trigger, reservationId: reservation.id, matchedActions: result.matched, status: result.status },
      });
    }
  } catch {
    // Best-effort — a broken workflow should never block the reservation
    // action that triggered it.
  }
}
