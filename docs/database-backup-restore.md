# Database backup & restore

## How backups work

`.github/workflows/backup-db.yml` runs every night at 23:00 UTC (03:00 Asia/Muscat)
and dumps the entire production database with `pg_dump`, uploading it as a
GitHub Actions artifact. Artifacts are kept for 90 days, giving a 90-day rolling
window of nightly snapshots — far beyond Neon's free-tier ~24h point-in-time
recovery window.

You can also trigger a backup manually anytime: GitHub repo → **Actions** tab →
**Nightly database backup** → **Run workflow**.

## One-time setup (do this once)

The workflow needs your database connection string as a GitHub secret:

1. Go to the repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `DATABASE_URL`
4. Value: the same connection string from your local `.env` file (starts with
   `postgresql://neondb_owner:...`).
5. Save.

Without this secret, the workflow fails loudly (with a clear error message) rather
than silently skipping — check the Actions tab if you ever want to confirm backups
are actually running.

## How to restore

1. Go to the repo on GitHub → **Actions** → **Nightly database backup** → pick the
   run you want → download the `weyn-db-backup-YYYY-MM-DD` artifact (a `.zip`
   containing one `.dump` file).
2. Unzip it locally.
3. **Restoring into a NEW database (safe — doesn't touch production):**
   ```bash
   createdb weyn_restore_test
   pg_restore --dbname=weyn_restore_test --no-owner --no-privileges weyn-backup-2026-07-04.dump
   ```
   Point `DATABASE_URL` at `weyn_restore_test` locally and confirm the data looks right
   before touching production.
4. **Restoring into production (destructive — only after the above check, and only
   if you're actually recovering from data loss):**
   ```bash
   pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges weyn-backup-2026-07-04.dump
   ```
   `--clean --if-exists` drops existing objects before recreating them from the
   dump — this is a full replace, not a merge. Take a fresh backup of current
   production state first if there's any chance you'd want to compare against it.

## What this does NOT cover

- **Point-in-time recovery** (restoring to an arbitrary moment, not just last
  night's snapshot) — that still depends on Neon's own PITR window (~24h on the
  free tier). Upgrading Neon's plan extends this if finer-grained recovery ever
  matters.
- **Uploaded images** (Vercel Blob storage) — not included in this backup, since
  they're a separate store from Postgres. Low risk: images are re-derivable from
  organizers re-uploading, unlike booking/ticket data.
