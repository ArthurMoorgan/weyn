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
  return jwt.sign({ sub: user.id, role: user.role }, SESSION_SECRET, { expiresIn: TOKEN_TTL });
}

// Attaches req.user (the full User row) if a valid session is present;
// never rejects the request itself — use requireAuth to actually enforce it.
export async function attachUser(req, _res, next) {
  const header = req.header("authorization") || req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !SESSION_SECRET) return next();
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    req.user = await db.getUserById(payload.sub);
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

// Loads the event at req.params.id, attaches it as req.event, and 403s
// unless the signed-in user owns it (or is an ADMIN). Events with no owner
// (pre-auth seed/legacy data) can only be touched by an ADMIN — never
// "claimable" by whoever edits them first.
export function requireEventOwner() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    const event = await db.get(req.params.id);
    if (!event) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found" } });
    const isOwner = event.ownerId && event.ownerId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't own this event" } });
    }
    req.event = event;
    next();
  };
}
