// Per-request user-id plumbing for the future RLS rollout (see
// prisma/rls-phase0/). The app uses a single shared Prisma Client / single
// Postgres role for all traffic (server/db.js), so Postgres's own
// `current_user` can't distinguish requests — instead, once RLS policies are
// enabled, every query needs `SET LOCAL app.user_id = '<id>'` run inside the
// same transaction, and that value has to come from *somewhere* per-request
// without threading a parameter through every single db.js function.
// AsyncLocalStorage gives us that: server/auth.js's attachUser middleware
// runs the rest of the request inside `asyncLocalStorage.run(...)`, and any
// code running during that request (however deep the call stack) can read
// the current user id back out via getCurrentUserId().
//
// Nothing reads this yet — see server/db.js's withRlsContext for the
// (not-yet-enabled) consumer. Today this module is inert: it only stores and
// retrieves a value, with no query behavior depending on it.
import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage();

// Returns the current request's signed-in User.id, or null if called outside
// an active request context (e.g. startup scripts, seed scripts) or during a
// signed-out request (attachUser never opens a context in that case).
export function getCurrentUserId() {
  const store = requestContext.getStore();
  return store?.userId ?? null;
}
