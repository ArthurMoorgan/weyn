-- ⚠️ PHASE 0 SCAFFOLDING — DO NOT RUN AGAINST PRODUCTION YET.
-- This migration is written but deliberately NOT applied. See
-- prisma/rls-phase0/README.md / the RLS rollout plan for the required
-- staging-validation phase before this can safely run against the live
-- database. Applying this without Phase 1 staging validation risks locking
-- out all access to these tables (Postgres RLS default-denies once enabled
-- with policies present).
--
-- This file lives OUTSIDE prisma/migrations/ on purpose — see the README in
-- this same directory for why, and for how to apply it once Phase 1/2 land.
--
-- Design notes (mirrors the app-layer authorization already enforced in
-- server/auth.js and server/db.js):
--   * The app uses ONE shared Postgres role for all traffic via a single
--     Prisma Client (see server/db.js's `realPrisma()` / PrismaPg adapter).
--     `current_user` is therefore useless for RLS. Instead, every request
--     that has a signed-in user must run:
--         SET LOCAL app.user_id = '<User.id>';
--     inside the same transaction as its queries (see
--     server/request-context.js + the withRlsContext extension sketch in
--     server/db.js for how this will be wired once RLS is actually enabled).
--   * Policies below read that value via current_setting('app.user_id', true)
--     — the `true` makes it return NULL instead of erroring when unset
--     (the signed-out case), which policies treat as "no user" and therefore
--     no rows match user-scoped predicates.
--   * `current_setting('app.user_id', true) = 'ADMIN_BYPASS'` is NOT used;
--     admin bypass instead re-checks the User row's role, matching
--     server/auth.js's `requireRole`/`isAdmin` checks, which key off
--     User.role, not a special session flag.

-- ============================================================================
-- Helper: resolve the current request's caller role, mirroring
-- server/auth.js's `req.user.role` checks. Returns NULL if no app.user_id is
-- set (signed-out) or the id doesn't match a live user.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_current_user_role() RETURNS TEXT AS $$
  SELECT role::TEXT FROM "User"
  WHERE id = current_setting('app.user_id', true) AND "deletedAt" IS NULL
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS TEXT AS $$
  SELECT current_setting('app.user_id', true)
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- User — mirrors: users can see/edit their own row; ADMIN can see/edit any
-- row (matches server/auth.js's requireRole('ADMIN') pattern used by admin
-- routes that look up/modify arbitrary users, e.g. ban/role-change flows).
-- ============================================================================
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_select_self_or_admin ON "User"
  FOR SELECT
  USING (
    id = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

CREATE POLICY user_update_self_or_admin ON "User"
  FOR UPDATE
  USING (
    id = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  )
  WITH CHECK (
    id = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

-- Row creation for User happens via server/db.js's upsertUserFromClerk,
-- effectively "system" writes tied to a verified Clerk session rather than
-- an existing app.user_id (the row may not exist yet on first sign-in) — no
-- INSERT policy is defined here deliberately; see README for how a Phase 1+
-- session should decide whether inserts need a dedicated bypass (e.g. a
-- SECURITY DEFINER function) rather than a broad INSERT policy.

-- ============================================================================
-- Event — mirrors: an owner can see/edit their own events (requireEventOwner/
-- requireEventAccess in server/auth.js); ADMIN can see/edit any event;
-- everyone (including signed-out) can see events that are already publicly
-- discoverable, matching db.js's `discoveryStatus IN ('APPROVED',
-- 'DISCOVERY_LIMITED')` visibility rule used by search/listing endpoints.
-- ============================================================================
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_select_public_or_owner_or_admin ON "Event"
  FOR SELECT
  USING (
    "discoveryStatus" IN ('APPROVED', 'DISCOVERY_LIMITED')
    OR "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "EventTeamMember" tm
      WHERE tm."eventId" = "Event".id
        AND tm."userId" = app_current_user_id()
        AND tm.status = 'ACCEPTED'
    )
  );

CREATE POLICY event_modify_owner_or_admin ON "Event"
  FOR UPDATE
  USING (
    "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "EventTeamMember" tm
      WHERE tm."eventId" = "Event".id
        AND tm."userId" = app_current_user_id()
        AND tm.status = 'ACCEPTED'
        AND tm.role IN ('MANAGER')
    )
  )
  WITH CHECK (
    "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "EventTeamMember" tm
      WHERE tm."eventId" = "Event".id
        AND tm."userId" = app_current_user_id()
        AND tm.status = 'ACCEPTED'
        AND tm.role IN ('MANAGER')
    )
  );

CREATE POLICY event_insert_own ON "Event"
  FOR INSERT
  WITH CHECK (
    "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

CREATE POLICY event_delete_owner_or_admin ON "Event"
  FOR DELETE
  USING (
    "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

-- ============================================================================
-- Booking — mirrors: an event owner (or MANAGER/STAFF team member) can see
-- bookings for their own events (server/db.js's attendeesForEvent,
-- eventAnalytics, dashboardSummary, recentActivity all scope by
-- ownerId/team-membership on the parent Event); a user can also see their
-- OWN bookings by booker identity. Booking has no direct userId column
-- today (bookings are matched by deviceId/email, not a User FK — see
-- schema.prisma) — the "own bookings" predicate below uses email match
-- against the current user's own email as the closest available proxy.
-- This is intentionally imperfect and called out for Phase 1 review: a
-- proper fix is adding Booking.userId in a future schema migration so RLS
-- (and the app layer) can key off identity rather than email string match.
-- ============================================================================
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_select_event_owner_team_or_own ON "Booking"
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "Booking"."eventId"
        AND (
          e."ownerId" = app_current_user_id()
          OR EXISTS (
            SELECT 1 FROM "EventTeamMember" tm
            WHERE tm."eventId" = e.id
              AND tm."userId" = app_current_user_id()
              AND tm.status = 'ACCEPTED'
          )
        )
    )
    OR (
      "Booking".email IS NOT NULL
      AND "Booking".email = (SELECT email FROM "User" WHERE id = app_current_user_id())
    )
  );

CREATE POLICY booking_modify_event_owner_or_admin ON "Booking"
  FOR UPDATE
  USING (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "Booking"."eventId"
        AND (
          e."ownerId" = app_current_user_id()
          OR EXISTS (
            SELECT 1 FROM "EventTeamMember" tm
            WHERE tm."eventId" = e.id
              AND tm."userId" = app_current_user_id()
              AND tm.status = 'ACCEPTED'
              AND tm.role IN ('MANAGER')
          )
        )
    )
  )
  WITH CHECK (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "Booking"."eventId"
        AND (
          e."ownerId" = app_current_user_id()
          OR EXISTS (
            SELECT 1 FROM "EventTeamMember" tm
            WHERE tm."eventId" = e.id
              AND tm."userId" = app_current_user_id()
              AND tm.status = 'ACCEPTED'
              AND tm.role IN ('MANAGER')
          )
        )
    )
  );

-- Bookings are also created for signed-out/device-only checkout flows (see
-- db.js's createPendingBooking/addBooking, which accept a deviceId with no
-- authenticated user at all) — no INSERT policy restricting to
-- app_current_user_id() is defined here, since that would break the
-- legitimate signed-out checkout path. Phase 1 should decide whether
-- booking creation needs a SECURITY DEFINER function instead of relying on
-- a broad allow-all INSERT policy.
CREATE POLICY booking_insert_anyone ON "Booking"
  FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- Report (admin-only moderation queue) — mirrors server/db.js's
-- listOpenReports/resolveReport, both used only from admin-gated routes.
-- Reporters can see reports they personally filed; only ADMIN can see/act on
-- the full queue.
-- ============================================================================
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_select_own_or_admin ON "Report"
  FOR SELECT
  USING (
    "reporterId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

CREATE POLICY report_insert_own ON "Report"
  FOR INSERT
  WITH CHECK (
    "reporterId" = app_current_user_id()
    OR "reporterId" IS NULL -- anonymous reports, if ever allowed by the app layer
  );

CREATE POLICY report_update_admin_only ON "Report"
  FOR UPDATE
  USING (app_current_user_role() = 'ADMIN')
  WITH CHECK (app_current_user_role() = 'ADMIN');

-- ============================================================================
-- ModerationResult (admin-only) — mirrors server/db.js's recordModeration/
-- listReviewQueue, both admin/system-pipeline only, never exposed to
-- regular users or even event owners.
-- ============================================================================
ALTER TABLE "ModerationResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY moderation_result_admin_only ON "ModerationResult"
  FOR ALL
  USING (app_current_user_role() = 'ADMIN')
  WITH CHECK (app_current_user_role() = 'ADMIN');

-- ============================================================================
-- EventTeamMember — mirrors server/db.js's listTeamMembers/createTeamInvite/
-- revokeTeamMember (all gated by requireEventOwner in server/app.js, i.e.
-- owner/ADMIN/MANAGER only) plus the invited member themselves being able to
-- see their own membership row (e.g. to accept/view their invite).
-- ============================================================================
ALTER TABLE "EventTeamMember" ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_member_select_owner_admin_member ON "EventTeamMember"
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR "userId" = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "EventTeamMember"."eventId"
        AND e."ownerId" = app_current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM "EventTeamMember" tm2
      WHERE tm2."eventId" = "EventTeamMember"."eventId"
        AND tm2."userId" = app_current_user_id()
        AND tm2.status = 'ACCEPTED'
        AND tm2.role = 'MANAGER'
    )
  );

CREATE POLICY team_member_modify_owner_admin_manager ON "EventTeamMember"
  FOR UPDATE
  USING (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "EventTeamMember"."eventId"
        AND e."ownerId" = app_current_user_id()
    )
    -- deliberately NOT including MANAGER team members here — schema.prisma's
    -- TeamRole comment: "MANAGER ... except ... managing the team itself ...
    -- that stays owner (or platform ADMIN) only"
  )
  WITH CHECK (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "EventTeamMember"."eventId"
        AND e."ownerId" = app_current_user_id()
    )
  );

CREATE POLICY team_member_insert_owner_admin ON "EventTeamMember"
  FOR INSERT
  WITH CHECK (
    app_current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e.id = "EventTeamMember"."eventId"
        AND e."ownerId" = app_current_user_id()
    )
  );

-- ============================================================================
-- Collection — mirrors server/db.js's listMyCollections/createCollection/
-- renameCollection/deleteCollection (owner-only mutation), plus getCollection
-- being reachable for any *public* collection (isPublic = true, matching the
-- "Public by default (link is shareable)" comment in schema.prisma) or by
-- the owner for private ones.
-- ============================================================================
ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_select_public_or_owner_or_admin ON "Collection"
  FOR SELECT
  USING (
    "isPublic" = true
    OR "ownerId" = app_current_user_id()
    OR app_current_user_role() = 'ADMIN'
  );

CREATE POLICY collection_modify_owner_or_admin ON "Collection"
  FOR UPDATE
  USING ("ownerId" = app_current_user_id() OR app_current_user_role() = 'ADMIN')
  WITH CHECK ("ownerId" = app_current_user_id() OR app_current_user_role() = 'ADMIN');

CREATE POLICY collection_insert_own ON "Collection"
  FOR INSERT
  WITH CHECK ("ownerId" = app_current_user_id());

CREATE POLICY collection_delete_owner_or_admin ON "Collection"
  FOR DELETE
  USING ("ownerId" = app_current_user_id() OR app_current_user_role() = 'ADMIN');

-- Note: CollectionItem inherits its access from the parent Collection via
-- application logic (server/db.js's getCollection joins through
-- collectionId), but Postgres RLS is per-table, not inherited through joins
-- automatically. A Phase 1 pass should add matching EXISTS-based policies on
-- CollectionItem itself (join to Collection on collectionId) before RLS is
-- actually enabled — left out of this Phase 0 draft to keep scope to the
-- tables explicitly named in the rollout plan (User, Event, Booking,
-- Report/ModerationResult, team-membership). Same caveat applies to Tier,
-- Ticket, Payment, AnalyticsEvent, AuditLog, PushToken, MarketingAsset,
-- Follow, Category — none of these are touched by this migration and remain
-- fully open (no RLS) until a future phase explicitly covers them.
