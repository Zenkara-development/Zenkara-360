-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'LEAD';
ALTER TYPE "EntityType" ADD VALUE 'ACCOUNT';
ALTER TYPE "EntityType" ADD VALUE 'CHANGE_REQUEST';
ALTER TYPE "EntityType" ADD VALUE 'QUOTE';
ALTER TYPE "EntityType" ADD VALUE 'ASSET';
ALTER TYPE "EntityType" ADD VALUE 'CAMPAIGN';

-- AlterTable (attachments table has no rows yet — safe to add NOT NULL columns directly)
ALTER TABLE "attachments" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE';
ALTER TABLE "attachments" ADD COLUMN "provider_file_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "attachments" ALTER COLUMN "provider_file_id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "storage_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE',
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "root_folder_id" TEXT NOT NULL,
    "connected_email" TEXT NOT NULL,
    "connected_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_configs_org_id_key" ON "storage_configs"("org_id");

-- AddForeignKey
ALTER TABLE "storage_configs" ADD CONSTRAINT "storage_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_configs" ADD CONSTRAINT "storage_configs_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
