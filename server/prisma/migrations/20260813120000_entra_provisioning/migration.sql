-- Entra ID SSO phase 2: JIT provisioning + group-to-role mapping. See
-- schema.prisma comments on DirectoryConfig's new columns and
-- DirectoryRoleMapping.

ALTER TABLE "directory_configs" ADD COLUMN "auto_provisioning_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "directory_configs" ADD COLUMN "default_role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE';

ALTER TABLE "users" ADD COLUMN "provisioned_via" TEXT;

CREATE TABLE "directory_role_mappings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "group_label" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_role_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "directory_role_mappings_org_id_group_id_key" ON "directory_role_mappings"("org_id", "group_id");
CREATE INDEX "directory_role_mappings_org_id_idx" ON "directory_role_mappings"("org_id");
ALTER TABLE "directory_role_mappings" ADD CONSTRAINT "directory_role_mappings_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
