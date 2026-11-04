-- Tagging: contact_tags + deal_tags  ->  record_tags
--
-- RUN THIS BEFORE `npx prisma db push`.
--
-- This project applies schema changes with `db push`, not versioned
-- migrations. The RecordTag change removes `contact_tags` and `deal_tags`,
-- so db push will DROP those two tables — and with them every tag anyone has
-- ever applied to a contact or a deal. This script creates the new table and
-- copies the rows across first, so the push has nothing left to lose.
--
--   psql "$DATABASE_URL" -f prisma/backfill-record-tags.sql
--   npx prisma db push
--
-- On Render, paste it into the database's SQL shell before redeploying.
--
-- Safe to run more than once: everything is IF NOT EXISTS or ON CONFLICT.

BEGIN;

-- ─── The new table ────────────────────────────────────────────────────────────
-- Shaped to match exactly what Prisma will generate for model RecordTag, so
-- the db push that follows sees no drift and makes no changes to it.

CREATE TABLE IF NOT EXISTS "record_tags" (
    "id"            TEXT         NOT NULL,
    "org_id"        TEXT         NOT NULL,
    "tag_id"        TEXT         NOT NULL,
    "entity_type"   "EntityType" NOT NULL,
    "entity_id"     TEXT         NOT NULL,
    "created_by_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_tags_pkey" PRIMARY KEY ("id")
);

-- Applying the same tag twice is a no-op rather than a duplicate row. This is
-- also what makes the two INSERTs below re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS "record_tags_tag_id_entity_type_entity_id_key"
    ON "record_tags" ("tag_id", "entity_type", "entity_id");

-- "which tags are on this record" — every record detail view.
CREATE INDEX IF NOT EXISTS "record_tags_org_id_entity_type_entity_id_idx"
    ON "record_tags" ("org_id", "entity_type", "entity_id");

-- "which records carry this tag" — the filter, and the usage count on the
-- tag manager screen.
CREATE INDEX IF NOT EXISTS "record_tags_org_id_tag_id_idx"
    ON "record_tags" ("org_id", "tag_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_tags_tag_id_fkey') THEN
        ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_tag_id_fkey"
            FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_tags_org_id_fkey') THEN
        ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_org_id_fkey"
            FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    -- SetNull, not Cascade: an employee leaving must not silently untag every
    -- record they ever touched.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_tags_created_by_id_fkey') THEN
        ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_created_by_id_fkey"
            FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ─── Backfill ─────────────────────────────────────────────────────────────────
-- org_id comes from the tag rather than the record: a ContactTag row could
-- only ever have been created by joining a contact to a tag in the same org,
-- and the tag is the side that carries org_id already.
--
-- The id is generated here rather than by Prisma, so it will not look like a
-- cuid. Nothing reads meaning out of these ids; uniqueness is all that is
-- required, and md5(random() || clock_timestamp()) needs no extension.

INSERT INTO "record_tags" ("id", "org_id", "tag_id", "entity_type", "entity_id", "created_by_id", "created_at")
SELECT
    'rt' || md5(random()::text || clock_timestamp()::text || ct."contact_id" || ct."tag_id"),
    t."org_id",
    ct."tag_id",
    'CONTACT'::"EntityType",
    ct."contact_id",
    NULL,
    CURRENT_TIMESTAMP
FROM "contact_tags" ct
JOIN "tags" t ON t."id" = ct."tag_id"
-- Only where the contact is still there: a dangling join row would become a
-- tag on a record that does not exist.
WHERE EXISTS (SELECT 1 FROM "contacts" c WHERE c."id" = ct."contact_id")
ON CONFLICT ("tag_id", "entity_type", "entity_id") DO NOTHING;

INSERT INTO "record_tags" ("id", "org_id", "tag_id", "entity_type", "entity_id", "created_by_id", "created_at")
SELECT
    'rt' || md5(random()::text || clock_timestamp()::text || dt."deal_id" || dt."tag_id"),
    t."org_id",
    dt."tag_id",
    'DEAL'::"EntityType",
    dt."deal_id",
    NULL,
    CURRENT_TIMESTAMP
FROM "deal_tags" dt
JOIN "tags" t ON t."id" = dt."tag_id"
WHERE EXISTS (SELECT 1 FROM "deals" d WHERE d."id" = dt."deal_id")
ON CONFLICT ("tag_id", "entity_type", "entity_id") DO NOTHING;

-- tags.module was only ever advisory, and now that a tag can land on any
-- record type, a tag stuck on module='CRM' would be hidden from tickets and
-- assets for no reason. Leave existing values alone (the tag manager still
-- shows them as a grouping) but make sure nothing is NULL.
UPDATE "tags" SET "module" = 'ALL' WHERE "module" IS NULL;

COMMIT;

-- ─── After this ───────────────────────────────────────────────────────────────
--   npx prisma db push
-- drops "contact_tags" and "deal_tags". Verify the copy landed first:
--
--   SELECT entity_type, count(*) FROM record_tags GROUP BY entity_type;
--   SELECT count(*) FROM contact_tags;   -- should match the CONTACT count
--   SELECT count(*) FROM deal_tags;      -- should match the DEAL count
