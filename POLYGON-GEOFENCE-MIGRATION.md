# Polygon geofencing — proposed schema change

**Status: proposed. NOT applied to the production database (`zenkara360`).**
The migration in `server/prisma/migrations/20261111025019_polygon_geofencing/` has
been applied to a development database only. It has **not** been run against
production. This document explains what it does, why it is needed, how to
roll it back, and what has to happen before it is applied.

---

## 1. Why a schema change is needed at all

The instruction was to inspect the existing tables first, so here is what
they can and cannot do today:

| Existing table | Can it hold a polygon boundary? | Can it hold an entry/exit event? |
|---|---|---|
| `office_locations` | **No.** It has `latitude`, `longitude` and `radiusMeters` — a centre point and a radius. There is nowhere to put a drawn boundary. | n/a |
| `attendance_location_pings` | No | **No.** It stores one row per GPS fix, with a boolean `inside`. It has no notion of a *crossing*, and it is purged on the org's `locationRetentionDays` (30 days by default). |
| `attendance_records` | No | **Partly.** `lastSeenInside` and `outsideSince` describe the *current* session only; when the session closes, the history of where the person went is gone. |
| `attendance_audits` | No | No — it records corrections made by staff, not device events. |

So two things are missing and both are needed:

1. a place to store the boundary, and
2. a place to store the boundary crossings.

## 2. What the migration does

### 2.1 `office_locations` — three new columns

```sql
ALTER TABLE "office_locations"
  ADD COLUMN "geofence_type"      TEXT NOT NULL DEFAULT 'CIRCLE',
  ADD COLUMN "polygon"             JSONB,
  ADD COLUMN "area_square_meters"  DOUBLE PRECISION;
```

* `geofence_type` — `'CIRCLE'` (the original behaviour) or `'POLYGON'`.
  **It defaults to `'CIRCLE'`, so every existing row keeps behaving exactly
  as it does today.** No existing office changes meaning.
* `polygon` — the boundary, as a GeoJSON Polygon: `{"type":"Polygon","coordinates":[[[lng,lat],…]]}`,
  longitude first, ring closed. `NULL` for a circular office.
* `area_square_meters` — the boundary's area, cached so the admin UI and the
  live map don't recompute it on every read.

All three are nullable or have a default, so the `ALTER TABLE` is a
metadata-only operation: no table rewrite, no long lock, and existing rows
are untouched.

### 2.2 `attendance_geofence_events` — a new table

One row per **boundary crossing** — not per GPS fix.

| Column | Purpose |
|---|---|
| `id`, `org_id`, `user_id` | Who, and in which organisation |
| `record_id` | The attendance session it happened during, when there was one |
| `office_location_id`, `office_name` | Which office was crossed |
| `event_type` | `ENTER` or `EXIT` |
| `at`, `lat`, `lng`, `accuracy` | When, where, and how precise the reading was |
| `source` | `HEARTBEAT`, `CHECK_IN`, `CHECK_OUT` or `STATUS_CHECK` |
| `seq` | Per-employee ordering |

Indexes: `(org_id, user_id, at)`, `(org_id, office_location_id, at)`,
`(record_id, at)`, and **unique `(user_id, seq)`**.

The unique index is the database-level guarantee that the same crossing
cannot be recorded twice: two writers racing for the same sequence number
means one of them is rejected.

### 2.3 Storage volume

A crossing is rare — a handful per person per day. The event table is
therefore *smaller* than the ping table it complements, not larger. Events
are not auto-purged: they are the audit trail for "the system says I wasn't
in the office", and they should outlive the 30-day ping retention.

## 3. Why the events are transitions, not pings

`attendance_location_pings` already stores every fix. Writing a second row
per ping here would duplicate the data, double the write rate and store it
twice as long. A crossing is the thing a human actually reviews.

Duplicates are prevented twice over:

1. **In the application** — a transition is only recorded when the new
   inside/outside state *differs* from the person's last recorded event. Ten
   GPS fixes in a row from the same side produce one `ENTER` and then
   nothing.
2. **In the database** — the unique `(user_id, seq)` index makes a
   concurrent double-write impossible.

## 4. Rolling it back

The rollback SQL lives beside the migration:
`server/prisma/migrations/20261111025019_polygon_geofencing/ROLLBACK.sql`.
It is **not** applied automatically — `prisma migrate deploy` only ever runs
`migration.sql`.

To roll back:

```bash
# 1. back up first
sudo -u postgres pg_dump -Fc zenkara360 > /tmp/pre-rollback.dump

# 2. deploy the previous version of the application code
#    (the API must not run against a schema it does not know about)

# 3. undo the schema change
psql -d zenkara360 -f server/prisma/migrations/20261111025019_polygon_geofencing/ROLLBACK.sql

# 4. clear the migration ledger so it can be applied cleanly later
psql -d zenkara360 -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261111025019_polygon_geofencing';"
```

The rollback drops the event table and the three columns. Because
`geofence_type` defaults to `'CIRCLE'` and the other two are `NULL`, every
office behaves exactly as it did before the change the moment the columns
are gone.

**The rollback is destructive of the event history** (the table is dropped).
Take the backup first if that history matters.

## 5. Applying it to production

Nothing has been applied. When it is approved:

```bash
cd /opt/zenkara360/server
npx prisma generate
npx prisma migrate deploy
```

`migrate deploy` is safe here: the migration is additive, and
`prisma migrate deploy` applies exactly the migrations that have not been
applied yet — it never re-runs or rewrites an existing one.

## 6. Backwards compatibility

* An office with no `geofence_type` is a `CIRCLE` — unchanged behaviour.
* `latitude`, `longitude` and `radiusMeters` keep their meaning for a
  circular office. For a polygon office the centre is *derived* from the
  boundary, so those columns stay meaningful (they describe where the office
  is) and the radius column is simply not consulted.
* `GET /hr/attendance/office-locations` gains three fields; every field it
  returned before is still there, with the same meaning.
* The check-in and check-out code path is the same one it always was — the
  only difference is that "is this point inside the office?" now also
  understands a drawn boundary.
