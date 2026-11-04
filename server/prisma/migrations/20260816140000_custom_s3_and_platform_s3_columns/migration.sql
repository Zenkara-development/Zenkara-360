-- Adds the columns the bring-your-own-S3 feature and the platform-level
-- hosted-bucket settings already assume exist.
--
-- These 13 columns were added to schema.prisma when CUSTOM_S3 / platform S3
-- support was written, but no migration was ever generated for them. Prisma
-- selects every mapped column by name, so `prisma.storageConfig.findUnique()`
-- and `prisma.platformSettings.findUnique()` both emitted SQL referencing
-- columns the database did not have, and Postgres answered
-- `column "s3_bucket" does not exist`. That surfaced as a 500 on
-- GET /api/storage/status — i.e. the Storage page failing to load at all —
-- and on the storage section of the platform admin console.
--
-- Every column is nullable with no default, matching the `String?` / `Boolean?`
-- declarations in schema.prisma. Nothing is backfilled: a null s3_bucket is
-- exactly the "not configured, fall back to the S3_* env vars" state both
-- code paths already handle, so existing rows stay correct and no org's
-- current storage provider changes.

-- ── storage_configs: per-org bring-your-own S3-compatible bucket (CUSTOM_S3) ──
-- s3_access_key_id / s3_secret_access_key hold customer cloud credentials and
-- are written encrypted with ENCRYPTION_KEY (utils/crypto.ts), same as the
-- Google Drive OAuth tokens in this table.
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_bucket" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_region" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_endpoint" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_access_key_id" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_secret_access_key" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_force_path_style" BOOLEAN;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_prefix" TEXT;
ALTER TABLE "storage_configs" ADD COLUMN IF NOT EXISTS "s3_label" TEXT;

-- ── platform_settings: the shared bucket behind provider 'HOSTED_S3' ──
-- Null here means "fall back to the S3_* environment variables", which is how
-- every existing deployment is configured today.
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "s3_bucket" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "s3_region" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "s3_endpoint" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "s3_access_key_id" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "s3_secret_access_key" TEXT;
