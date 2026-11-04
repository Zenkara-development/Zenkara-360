-- StorageConfig gains a second provider, 'HOSTED_S3', which has no per-org
-- OAuth connection details (it's a shared bucket keyed by orgId, configured
-- via global S3_* env vars — see utils/s3Storage.ts). These five columns are
-- Google Drive-only, so they need to become optional rather than required.
ALTER TABLE "storage_configs" ALTER COLUMN "access_token" DROP NOT NULL;
ALTER TABLE "storage_configs" ALTER COLUMN "refresh_token" DROP NOT NULL;
ALTER TABLE "storage_configs" ALTER COLUMN "token_expires_at" DROP NOT NULL;
ALTER TABLE "storage_configs" ALTER COLUMN "root_folder_id" DROP NOT NULL;
ALTER TABLE "storage_configs" ALTER COLUMN "connected_email" DROP NOT NULL;
