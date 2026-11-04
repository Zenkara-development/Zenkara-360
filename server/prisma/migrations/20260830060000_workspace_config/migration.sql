-- Workspace identity config (platform Phase 1): one JSON blob per org.
CREATE TABLE "workspace_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_configs_org_id_key" ON "workspace_configs"("org_id");

ALTER TABLE "workspace_configs" ADD CONSTRAINT "workspace_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
