# RLS Phase 0 — scaffolding only, NOT applied

This directory is deliberately **outside** `prisma/migrations/`.

Why: Prisma's migration tooling (`prisma migrate deploy`, `prisma migrate dev`,
`prisma migrate resolve`, etc.) only ever looks inside `prisma/migrations/`,
reading folder names in lexical/timestamp order and recording each one it
applies in the `_prisma_migrations` table. If this SQL file lived inside
`prisma/migrations/<timestamp>_add_rls_policies/migration.sql`, then the
very next time anyone (or any script, now or in the future) ran
`npx prisma migrate deploy` against the production `DATABASE_URL` — including
by accident, or because a future CI/deploy pipeline adds that step — this
would be picked up and applied automatically, with no extra confirmation
step. Enabling Postgres RLS with policies present is **default-deny**: if
applied before the app is actually passing `app.user_id` on every request
path (and before staging validation confirms the policies match real access
patterns), this would silently lock out reads/writes across User, Event,
Booking, and related tables in production.

As of this writing (checked in `.github/workflows/ci.yml` and
`package.json`):
- `.github/workflows/ci.yml` only runs `npx prisma generate`, `npm run build`,
  and `npm test`. It never runs `migrate deploy`, `db push`, or `db execute`.
- `package.json` has no script that runs a prisma migrate/db command against
  `DATABASE_URL` (`vercel:deploy` just builds and calls `vercel deploy --prod`).

So today, nothing would auto-apply this even from `prisma/migrations/`. But
since a future session or a future CI change could add a `migrate deploy`
step without knowing this file's intent, keeping it physically outside
`prisma/migrations/` removes that failure mode entirely rather than relying
on people remembering a comment.

## How to actually apply this (future phase, staging first)

1. Do NOT run this against the production database directly.
2. Stand up a staging/branch database (e.g. a Neon branch) with a copy of
   production schema + representative data.
3. Confirm `server/request-context.js` + the `attachUser` AsyncLocalStorage
   wiring (see `server/auth.js`) is deployed and actually setting
   `app.user_id` per request in that environment.
4. Apply `manual-migration.sql` directly against the staging database with
   `psql "$STAGING_DATABASE_URL" -f prisma/rls-phase0/manual-migration.sql`
   (not via `prisma migrate deploy` — this file is intentionally not a
   tracked Prisma migration).
5. Exercise the app end-to-end against staging: signed-out browsing, signed-in
   owner access, cross-user access attempts, admin routes, team-member
   access. Confirm nothing that should work is blocked, and nothing that
   should be blocked leaks through only because the app layer still also
   enforces it.
6. Only after staging validation, plan a maintenance-window application to
   production, ideally by copying this file into a real
   `prisma/migrations/<timestamp>_add_rls_policies/migration.sql` at that
   time (so it becomes part of the tracked migration history going forward)
   and running `prisma migrate deploy` deliberately, with a rollback plan
   (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY;` for every table touched).

## Rollback if something goes wrong after applying

```sql
ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Report" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "ModerationResult" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "EventTeamMember" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Collection" DISABLE ROW LEVEL SECURITY;
```
