-- Microsoft Entra ID SSO (phase 1: login only) — see schema.prisma comments
-- on DirectoryConfig and User.entraObjectId.

ALTER TABLE "users" ADD COLUMN "entra_object_id" TEXT;
CREATE UNIQUE INDEX "users_entra_object_id_key" ON "users"("entra_object_id");

CREATE TABLE "directory_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "login_slug" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "directory_configs_org_id_key" ON "directory_configs"("org_id");
CREATE UNIQUE INDEX "directory_configs_login_slug_key" ON "directory_configs"("login_slug");
ALTER TABLE "directory_configs" ADD CONSTRAINT "directory_configs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
