// Real session layer, on top of Google Sign-In's identity verification.
// Before this, "organizer" was just a free-text string the client sent —
// nothing stopped anyone from editing/cancelling any event by ID. Now:
// POST /api/auth/google verifies the Google ID token (unchanged) AND issues
// a Weyn session JWT tied to a real User row; every mutating route below
// requires that JWT and checks it against the event's actual ownerId.
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const SESSION_SECRET = process.env.SESSION_SECRET;
const TOKEN_TTL = "30d";

export function authConfigured() {
  return !!SESSION_SECRET;
}

export function issueSessionToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion }, SESSION_SECRET, { expiresIn: TOKEN_TTL });
}

// Attaches req.user (the full User row) if a valid session is present;
// never rejects the request itself — use requireAuth to actually enforce it.
export async function attachUser(req, _res, next) {
  const header = req.header("authorization") || req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !SESSION_SECRET) return next();
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    const user = await db.getUserById(payload.sub);
    // tokenVersion mismatch = this JWT was issued before a forced sign-out
    // (ban, role change) bumped it — a 30-day-lived token has no other way
    // to be revoked early, since we don't keep a server-side session store.
    if (user && user.tokenVersion === payload.tv) req.user = user;
  } catch {
    // expired/tampered token — treat as signed out rather than erroring the request
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
