-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20261111025019_polygon_geofencing
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NOT applied automatically. Prisma's `migrate deploy` only ever runs
-- migration.sql; this file exists so the change can be undone deliberately,
-- with a human reading it first.
--
-- To roll back:
--   1. Take a fresh backup:  sudo -u postgres pg_dump -Fc zenkara360 > /tmp/pre-rollback.dump
--   2. Deploy the previous version of the application code (the API must not
--      be running against a schema it doesn't know about).
--   3. psql -d zenkara360 -f ROLLBACK.sql
--   4. Delete the row Prisma uses to track what has been applied, so the
--      migration can be re-applied cleanly later:
--        DELETE FROM _prisma_migrations WHERE migration_name = '20261111025019_polygon_geofencing';
--
-- What it does, in order:
--   • drops the geofence event table (the new data goes with it — take the
--     backup first if the entry/exit history matters),
--   • removes the three polygon columns from office_locations, restoring the
--     table to exactly its previous shape,
--   • leaves every pre-existing row untouched: geofence_type has a default
--     of 'CIRCLE' and polygon/area_square_meters are NULL, so after the
--     rollback every office behaves exactly as it did before this change.
--
-- The ordering matters: the FK constraints from attendance_geofence_events
-- are dropped with the table, so nothing else has to be touched.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TABLE IF EXISTS "attendance_geofence_events";

ALTER TABLE "office_locations"
  DROP COLUMN IF EXISTS "area_square_meters",
  DROP COLUMN IF EXISTS "geofence_type",
  DROP COLUMN IF EXISTS "polygon";

COMMIT;

-- Run this by hand after the ALTERs, so Prisma's migration ledger matches
-- the database again:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111025019_polygon_geofencing';
