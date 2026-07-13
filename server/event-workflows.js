// Event Workflows — the organizer-dashboard node-graph automation builder,
// full parity with server/venue-workflows.js (same shape: one trigger node
// -> condition node(s) -> action node(s), edges expressing "and then"/fan-
// out, DFS walk that prunes a branch when a condition fails and lets
// actions chain). Deliberately NOT modeling true if/else branching, loops,
// approvals, or scheduled/retry execution — same scope note as the venue
// side. Evaluated immediately when the trigger genuinely happens (a ticket
// is issued, an event is published, a waitlist entry is created, a promo
// code is redeemed) — never a poll cycle.
import { prisma } from "./db.js";
import { sendEmail } from "./email.js";
import { sendPush } from "./push.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const EVENT_TRIGGERS = ["ticket_sold", "low_inventory", "event_published", "waitlist_joined", "promo_code_used"];
export const EVENT_CONDITION_FIELDS = ["ticketTier", "quantityRemaining", "attendeeEmailDomain"];
export const EVENT_ACTIONS = ["notify_team", "send_campaign", "apply_promo_code", "add_to_waitlist_priority"];

// Validates a graph's shape at save time — exactly one trigger node, every
// edge references a real node, node `data` matches its type's expected
// fields. Doesn't reject unreachable nodes (a work-in-progress graph with a
// dangling node is fine to save, just won't do anything for that branch yet).
export function validateEventWorkflowGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return "nodes and edges must be arrays";
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) return "A workflow needs exactly one trigger node";
  if (!EVENT_TRIGGERS.includes(triggers[0].data?.trigger)) return "Invalid trigger type";
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) return "An edge references a node that doesn't exist";
  }
  for (const n of nodes) {
    if (n.type === "condition" && !EVENT_CONDITION_FIELDS.includes(n.data?.field)) return "Invalid condition field";
    if (n.type === "action" && !EVENT_ACTIONS.includes(n.data?.action)) return "Invalid action type";
  }
  return null;
}

// `ctx` — the trigger-time context every condition/action reads from.
// Assembled by the caller (server/app.js's hooks below) from whatever data
// that specific trigger actually has on hand; fields not relevant to a
// given trigger are simply absent/null (e.g. `event_published` has no
// bookingId).
// {
//   eventId, bookingId?, tierId?, tierName?, email?, qty?,
//   quantityRemaining?, capacity?, promoCode?,
// }

function evaluateCondition(node, ctx) {
  const { field, op, value } = node.data || {};
  if (field === "ticketTier") {
    const has = String(ctx.tierName || "").toLowerCase() === String(value || "").toLowerCase();
    return op === "not_equals" ? !has : has;
  }
  if (field === "quantityRemaining") {
    if (ctx.quantityRemaining == null) return false;
    const v = Number(value);
    if (op === "<=") return ctx.quantityRemaining <= v;
    if (op === ">=") return ctx.quantityRemaining >= v;
    return ctx.quantityRemaining === v;
  }
  if (field === "attendeeEmailDomain") {
    const domain = String(ctx.email || "").split("@")[1]?.toLowerCase() || "";
    const target = String(value || "").toLowerCase().replace(/^@/, "");
    const has = domain === target;
    return op === "not_equals" ? !has : has;
  }
  return true;
}

async function runActionNode(node, ctx, event) {
  const cfg = node.data?.config || {};
  const action = node.data?.action;
  try {
    if (action === "notify_team") {
      const members = await prisma.eventTeamMember.findMany({
        where: { eventId: event.id, status: "ACCEPTED" },
        select: { invitedEmail: true, userId: true },
      });
      const recipients = new Set(members.map((m) => m.invitedEmail).filter(Boolean));
      if (event.ownerId) {
        const owner = await prisma.user.findUnique({ where: { id: event.ownerId }, select: { email: true } });
        if (owner?.email) recipients.add(owner.email);
      }
      if (!recipients.size) return { nodeId: node.id, action, ok: false, error: "No team members or owner email on file" };
      const subject = cfg.subject || "Workflow alert";
      const safeMessage = escapeHtml(cfg.message || `${event.title}: a workflow just fired.`);
      await Promise.all([...recipients].map((to) =>
        sendEmail({
          to, subject: `${event.title}: ${subject}`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2><p style="white-space:pre-wrap;line-height:1.5;color:#222">${safeMessage}</p></div>`,
        }).catch(() => {})
      ));
      // Best-effort native/web push to any team member with a linked account
      // (invitedEmail-only members with no userId have nothing to push to).
      const pushable = members.filter((m) => m.userId);
      await Promise.all(pushable.map(async (m) => {
        // Reuses the same per-user push fan-out the rest of the app uses
        // (native tokens + web push subscriptions) — deferred import avoids
        // a hard circular dependency with server/app.js at module-load time.
        const { notifyUser } = await import("./app.js");
        return notifyUser(m.userId, { title: event.title, body: subject }).catch(() => {});
      }));
    } else if (action === "send_campaign") {
      if (!cfg.subject || !cfg.message) return { nodeId: node.id, action, ok: false, error: "subject and message are required" };
      // Reuses the exact function behind POST /api/events/:id/notify — no
      // reimplementation of the bulk-send fan-out.
      const { sendEventNotificationNow } = await import("./app.js");
      await sendEventNotificationNow(event, { subject: cfg.subject, message: cfg.message, actorId: event.ownerId || null });
    } else if (action === "apply_promo_code") {
      if (!cfg.code) return { nodeId: node.id, action, ok: false, error: "code is required" };
      const code = String(cfg.code).trim().toUpperCase();
      const promo = await prisma.promoCode.findUnique({ where: { eventId_code: { eventId: event.id, code } } });
      if (!promo) return { nodeId: node.id, action, ok: false, error: `No promo code "${code}" on this event` };
      const data = { active: true };
      if (cfg.extendDays) {
        const base = promo.endsAt && promo.endsAt > new Date() ? promo.endsAt : new Date();
        data.endsAt = new Date(base.getTime() + Number(cfg.extendDays) * 86400e3);
      }
      await prisma.promoCode.update({ where: { id: promo.id }, data });
    } else if (action === "add_to_waitlist_priority") {
      if (!ctx.email) return { nodeId: node.id, action, ok: false, error: "No attendee email in this trigger's context" };
      const priority = Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 1;
      await prisma.waitlistEntry.updateMany({
        where: { eventId: event.id, email: ctx.email.toLowerCase() },
        data: { priority },
      });
    }
    return { nodeId: node.id, action, ok: true };
  } catch (err) {
    return { nodeId: node.id, action, ok: false, error: err.message || String(err) };
  }
}

// Walks the graph depth-first from the trigger node — same shape as
// server/venue-workflows.js's walk(): a failing condition prunes its whole
// branch, an action always runs and its children continue after it (so
// actions can chain).
async function walk(node, byId, childrenOf, ctx, event, matched) {
  const children = childrenOf.get(node.id) || [];
  for (const childId of children) {
    const child = byId.get(childId);
    if (!child) continue;
    if (child.type === "condition") {
      if (!evaluateCondition(child, ctx)) continue;
      await walk(child, byId, childrenOf, ctx, event, matched);
    } else if (child.type === "action") {
      matched.push(await runActionNode(child, ctx, event));
      await walk(child, byId, childrenOf, ctx, event, matched);
    }
  }
}

export async function runEventWorkflowGraph(workflow, ctx, event) {
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
  await walk(trigger, byId, childrenOf, ctx, event, matched);
  const status = matched.length === 0 ? "success" : matched.every((m) => m.ok) ? "success" : matched.some((m) => m.ok) ? "partial" : "failed";
  return { matched, status };
}

// Called right at the point each trigger genuinely happens (see the hooks
// in server/app.js) — never a batch scan. Always fire-and-forget
// (`.catch(() => {})` at every call site) so a broken workflow never blocks
// the real checkout/publish/waitlist action that triggered it.
// Redemption bookkeeping for `promo_code_used` — a real gap this pass
// closes, not a pre-existing hook: POST /api/promo-codes/validate only ever
// checked a code (called freely as someone types, no side effects), and
// nothing anywhere incremented PromoCode.usedCount. Called from the actual
// booking-creation routes (server/app.js: free RSVP, paid checkout,
// organizer-payment checkout) when the buyer supplied a promoCode, so a
// redemption is tied to a real booking rather than every keystroke of a
// validation check. Deliberately doesn't touch what the buyer is actually
// charged (priceFor() in app.js) — that's a separate, pre-existing gap
// (promo codes were never wired into pricing at all), out of scope for the
// workflows build.
export async function redeemPromoCode(eventId, rawCode) {
  if (!rawCode) return null;
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return null;
  const now = new Date();
  // Same atomic conditional-UPDATE pattern as db.claimTierCapacity — the
  // WHERE clause IS the validity check, so two concurrent redemptions can't
  // both slip past maxUses.
  const rows = await prisma.$queryRaw`
    UPDATE "PromoCode" SET "usedCount" = "usedCount" + 1
    WHERE "eventId" = ${eventId} AND code = ${code} AND active = true
      AND ("startsAt" IS NULL OR "startsAt" <= ${now})
      AND ("endsAt" IS NULL OR "endsAt" >= ${now})
      AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
    RETURNING id, code, "discountType", "discountValue"
  `;
  return rows[0] || null;
}

export async function runEventWorkflows(trigger, ctx) {
  try {
    const workflows = await prisma.eventWorkflow.findMany({ where: { eventId: ctx.eventId, enabled: true } });
    if (!workflows.length) return;
    const relevant = workflows.filter((w) => {
      const triggerNode = (w.nodes || []).find((n) => n.type === "trigger" && n.data?.trigger === trigger);
      if (!triggerNode) return false;
      // "low_inventory" carries a per-workflow threshold on the trigger node
      // itself (data.config.threshold, default 10) rather than a fixed
      // app-wide cutoff — the caller (server/app.js) fires this trigger for
      // every ticket sale and lets each workflow decide if its own bar was
      // crossed.
      if (trigger === "low_inventory") {
        const threshold = Number(triggerNode.data?.config?.threshold);
        const bar = Number.isFinite(threshold) ? threshold : 10;
        if (ctx.quantityRemaining == null || ctx.quantityRemaining > bar) return false;
      }
      return true;
    });
    if (!relevant.length) return;
    const event = await prisma.event.findUnique({ where: { id: ctx.eventId } });
    if (!event) return;
    // ticketTier condition needs a human name, not just the id the caller had on hand.
    if (ctx.tierId && !ctx.tierName) {
      const tier = await prisma.tier.findUnique({ where: { id: ctx.tierId }, select: { name: true } });
      if (tier) ctx.tierName = tier.name;
    }
    for (const workflow of relevant) {
      const result = await runEventWorkflowGraph(workflow, ctx, event);
      if (!result) continue;
      await prisma.eventWorkflowRun.create({
        data: { workflowId: workflow.id, trigger, bookingId: ctx.bookingId || null, matchedActions: result.matched, status: result.status },
      });
    }
  } catch {
    // Best-effort — a broken workflow should never block the action that triggered it.
  }
}
