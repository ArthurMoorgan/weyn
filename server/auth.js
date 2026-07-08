// Real session layer, backed by Clerk (replaces the old Google Sign-In +
// hand-rolled JWT system). Clerk verifies who the visitor is; every
// mutating route below still requires req.user and checks it against the
// event's actual ownerId — that part is unchanged.
import { createClerkClient } from "@clerk/backend";
import { db } from "./db.js";
import { requestContext } from "./request-context.js";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
const clerkClient = CLERK_SECRET_KEY ? createClerkClient({ secretKey: CLERK_SECRET_KEY }) : null;

export function authConfigured() {
  return !!CLERK_SECRET_KEY;
}

// Short-TTL cache of resolved User rows, keyed by verified Clerk user id, so
// a burst of authenticated requests from one user doesn't fan out into one
// Clerk getUser() API call + one DB upsert each. 60s is short enough that a
// profile edit (name/avatar) shows up promptly, long enough to collapse the
// per-request storm. On Cloudflare this lives per-isolate (best-effort); on
// Node it's process-wide. Bounded so it can't grow without limit.
const userCache = new Map(); // clerkUserId -> { user, expires }
const USER_TTL_MS = 60_000;

async function resolveClerkUser(clerkUserId) {
  const now = Date.now();
  const hit = userCache.get(clerkUserId);
  if (hit && hit.expires > now) return hit.user;
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId) || clerkUser.emailAddresses[0];
  const user = await db.upsertUserFromClerk({
    clerkUserId: clerkUser.id,
    email: primaryEmail?.emailAddress || `${clerkUser.id}@no-email.clerk`,
    name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || primaryEmail?.emailAddress || "You",
    avatarUrl: clerkUser.imageUrl || null,
  });
  if (userCache.size > 5000) userCache.clear(); // crude bound; correctness doesn't depend on the cache
  userCache.set(clerkUserId, { user, expires: now + USER_TTL_MS });
  return user;
}

// Attaches req.user (the full User row, looked up/created by Clerk user id)
// if a valid Clerk session is present; never rejects the request itself —
// use requireAuth to actually enforce it. Clerk's own session cookie/token
// is read straight off the request (no manual Bearer header plumbing needed
// on the frontend since app + API are same-origin).
export async function attachUser(req, _res, next) {
  if (!clerkClient) return next();
  try {
    const request = new Request(`${req.protocol}://${req.get("host")}${req.originalUrl}`, {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])
      ),
    });
    const requestState = await clerkClient.authenticateRequest(request, { publishableKey: CLERK_PUBLISHABLE_KEY });
    const auth = requestState.toAuth();
    if (auth?.userId) {
      // The session token above is already cryptographically verified on
      // every request — this getUser() + DB upsert only refreshes profile
      // fields (name/email/avatar), so caching the resolved User row per
      // Clerk id for a short TTL avoids hammering Clerk's API (and the DB)
      // on every authenticated request, which was both a latency cost and a
      // real availability risk (flood of authed calls -> Clerk rate limit ->
      // auth breaks app-wide). Cache never widens access: it's keyed on the
      // freshly-verified auth.userId, and misses fall through to a live fetch.
      req.user = await resolveClerkUser(auth.userId);
    }
  } catch {
    // not signed in / invalid session — treat as signed out rather than erroring the request
  }
  // Run the rest of this request inside an AsyncLocalStorage context carrying
  // the signed-in user's id, so any downstream Prisma call (however deep the
  // call stack) can read it back via server/request-context.js's
  // getCurrentUserId() — this is the plumbing a future RLS phase needs to run
  // `SET LOCAL app.user_id = ...` per request. Signed-out requests skip the
  // context entirely; getCurrentUserId() returning null in that case is the
  // correct signed-out behavior, matching every other check in this file.
  if (req.user) {
    return requestContext.run({ userId: req.user.id }, next);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    if (req.user.role !== role && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't have permission to do that" } });
    }
    next();
  };
}

// Team roles rank lowest-to-highest privilege for this event. STAFF is
// door-only (check-in); MANAGER has full event powers except managing the
// team itself or transferring ownership (owner/ADMIN only for those).
const TEAM_ROLE_RANK = { STAFF: 1, MANAGER: 2 };

// Loads the event at req.params.id, attaches it as req.event, and 403s
// unless the signed-in user owns it, is an ADMIN, or holds an accepted team
// membership at >= minTeamRole. Events with no owner (pre-auth seed/legacy
// data) can only be touched by an ADMIN — never "claimable" by whoever
// edits them first.
export function requireEventAccess(minTeamRole = "MANAGER") {
  const minRank = TEAM_ROLE_RANK[minTeamRole];
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    const event = await db.get(req.params.id);
    if (!event) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const isOwner = event.ownerId && event.ownerId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    let hasTeamAccess = false;
    if (!isOwner && !isAdmin) {
      const membership = await db.getTeamMembership(event.id, req.user.id);
      hasTeamAccess = !!membership && TEAM_ROLE_RANK[membership.role] >= minRank;
    }
    if (!isOwner && !isAdmin && !hasTeamAccess) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't have access to this event" } });
    }
    req.event = event;
    next();
  };
}

// Back-compat name — full event-management access (owner/ADMIN/MANAGER).
export const requireEventOwner = () => requireEventAccess("MANAGER");

// Same as requireEventAccess("MANAGER") but also lets in a STAFF member who
// was granted this specific permission tag at invite time (see
// server/app.js's TEAM_PERMISSIONS) — the one place today where a STAFF
// member's granular permissions actually gate a route, rather than just
// being stored/displayed.
export function requireEventAccessOrPermission(permission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    const event = await db.get(req.params.id);
    if (!event) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const isOwner = event.ownerId && event.ownerId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    let allowed = isOwner || isAdmin;
    if (!allowed) {
      const membership = await db.getTeamMembership(event.id, req.user.id);
      allowed = !!membership && (TEAM_ROLE_RANK[membership.role] >= TEAM_ROLE_RANK.MANAGER || (membership.permissions || []).includes(permission));
    }
    if (!allowed) return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't have access to this event" } });
    req.event = event;
    next();
  };
}

// Strictly owner/ADMIN — deliberately excludes MANAGER team members, so a
// MANAGER can run the event day-to-day but can't invite more team members,
// remove someone else's access, or (via a separate check elsewhere)
// transfer/delete the event outright.
export function requireEventOwnerStrict() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    const event = await db.get(req.params.id);
    if (!event) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const isOwner = event.ownerId && event.ownerId === req.user.id;
    if (!isOwner && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the event owner can do that" } });
    }
    req.event = event;
    next();
  };
}
