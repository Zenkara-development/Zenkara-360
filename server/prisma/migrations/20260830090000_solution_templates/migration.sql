-- Phase 4 of the platform play: saved workspace blueprints ("solution
-- templates") an org can snapshot and, when shared, stamp onto other orgs.
CREATE TABLE "solution_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "blueprint" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solution_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solution_templates_org_id_idx" ON "solution_templates"("org_id");
CREATE INDEX "solution_templates_is_shared_idx" ON "solution_templates"("is_shared");

ALTER TABLE "solution_templates" ADD CONSTRAINT "solution_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
