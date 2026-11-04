-- Tagging rework: contact_tags + deal_tags -> one polymorphic record_tags.
--
-- REORDERED from what `prisma migrate dev` generated: the auto-generated
-- version DROPped contact_tags/deal_tags first and only then created
-- record_tags, silently destroying every tag ever applied to a contact or
-- deal in any environment that ran it without first running the manual
-- prisma/backfill-record-tags.sql script. This version creates the new
-- table, copies the rows across INSIDE the migration, and only then drops
-- the old tables — so `prisma migrate deploy` is safe on its own, with no
-- manual step to remember. (Environments where this migration already ran
-- are unaffected: Prisma never re-runs an applied migration.)
-- The standalone backfill script is kept for db-push-managed databases and
-- is idempotent alongside this.

-- ─── 1. New table + indexes ──────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "record_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_tags_org_id_entity_type_entity_id_idx" ON "record_tags"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "record_tags_org_id_tag_id_idx" ON "record_tags"("org_id", "tag_id");

-- CreateIndex (also what makes the backfill INSERTs conflict-safe)
CREATE UNIQUE INDEX "record_tags_tag_id_entity_type_entity_id_key" ON "record_tags"("tag_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tags_org_id_module_idx" ON "tags"("org_id", "module");

-- AddForeignKey
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2. Backfill from the old join tables ────────────────────────────────────
-- org_id comes from the tag (the side that already carries it); rows whose
-- contact/deal no longer exists are skipped rather than becoming tags on
-- nothing. Ids only need to be unique — nothing parses them as cuids.

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

-- ─── 3. Only now drop the old tables ─────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_tag_id_fkey";

-- DropForeignKey
ALTER TABLE "deal_tags" DROP CONSTRAINT "deal_tags_deal_id_fkey";

-- DropForeignKey
ALTER TABLE "deal_tags" DROP CONSTRAINT "deal_tags_tag_id_fkey";

-- DropTable
DROP TABLE "contact_tags";

-- DropTable
DROP TABLE "deal_tags";
